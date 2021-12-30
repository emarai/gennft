const FormData = require('form-data')
const axios = require('axios')
const fs = require('fs')
const { readdir } = require('fs/promises');
const path = require('path')
const nearAPI = require('near-api-js')
const { Base64 } = require('js-base64')
const retry = require('async-retry')
const { encodeImageToBlurhash } = require('./lib/blurhash')

const PARAS_API_URL = process.env.PARAS_API_URL // https://api-v2-testnet.paras.id
const BUILD_PATH = process.env.BUILD_PATH // /home/projects/generator/build
const PARAS_TOKEN_CONTRACT = process.env.PARAS_TOKEN_CONTRACT // paras-token-v1.testnet
const accountId = 'projectp.testnet'
const collection_id = 'example-avatar-by-projectptestnet'

const uploadMetadata = async (filePath, authToken, reference) => {

    const formData = new FormData()
    const readStream = fs.createReadStream(filePath)
    formData.append('files', readStream)
    formData.append('files', JSON.stringify(reference), 'reference.json')
    const headers = {
        'Authorization': authToken,
        ...formData.getHeaders()
    }

    return await retry(
        async () => {
            try {
                const res = await axios.post(`${PARAS_API_URL}/uploads`, formData, {
                    headers: headers
                })
                return res
            } catch (err) {
                console.log(err)
            }
        },
        {
            retries: 10,
            minTimeout: 30000,
            maxTimeout: 60000
        }
    )
}

const generateAuthToken = async (accountId, signer, networkId) => {
    try {
        const arr = new Array(accountId)
        for (let i = 0; i < accountId.length; i++) {
            arr[i] = accountId.charCodeAt(i)
        }
        const msgBuf = new Uint8Array(arr)
        const signedMsg = await signer.signMessage(
            msgBuf,
            accountId,
            networkId
        )

        const pubKey = Buffer.from(signedMsg.publicKey.data).toString('hex')
        const signature = Buffer.from(signedMsg.signature).toString('hex')
        const payload = [accountId, pubKey, signature]
        return Base64.encode(payload.join('&'))
    } catch (err) {
        console.log(err)
        return null
    }
}

const main = async () => {
    console.log('Starting script...')

    // assert that collection exits
    const collectionResult = await axios.get(`${PARAS_API_URL}/collections`, {
        params: {
            creator_id: accountId,
            collection_id: collection_id
        }
    })
    const collection = collectionResult.data.data.results[0]

    if (collection.collection_id != collection_id) {
        console.log('Collection does not exist')
        process.exit(1)
    }

    const keyStore = new nearAPI.keyStores.UnencryptedFileSystemKeyStore(
        `${process.env.HOME}/.near-credentials/`
    )

    const NEAR_CONFIG = {
        networkId: "testnet",
        keyStore: keyStore,
        nodeUrl: "https://rpc.testnet.near.org",
        walletUrl: "https://wallet.testnet.near.org"
    }

    const signer = new nearAPI.InMemorySigner(keyStore)

    const near = await nearAPI.connect({
        deps: {
            keyStore: keyStore,
        },
        ...NEAR_CONFIG,
    })

    const account = await near.account(accountId)

    const tokenContract = new nearAPI.Contract(
        account,
        PARAS_TOKEN_CONTRACT,
        {
            changeMethods: ["nft_create_series"],
        }
    )

    for (let i = 1; i <= 50; i++) {
        const imgFileName = `paras-avatar_${i.toString().padStart(4, '0')}_large.png`
        const jsonFileName = `paras-avatar_${i.toString().padStart(4, '0')}.json`
        const imgFilePath = `${BUILD_PATH}/${imgFileName}`
        const jsonFilePath = `${BUILD_PATH}/${jsonFileName}`

        const imgBlurhash = await encodeImageToBlurhash(`${imgFilePath}`)

        // upload image and reference json
        const authToken = await generateAuthToken(accountId, signer, NEAR_CONFIG.networkId)

        const attributesJson = require(jsonFilePath)
        let attributes = []
        for (const attr of Object.keys(attributesJson)) {
            attributes.push({
                trait_type: attributesJson[attr].name,
                value: attributesJson[attr].value
            })
        }

        const reference = {
            description: 'Paras Example Avatar',
            collection: collection.collection,
            collection_id: collection.collection_id,
            creator_id: accountId,
            attributes: attributes,
            blurhash: imgBlurhash,
        }
        console.log(reference)

        const uploadMetadataResp = await uploadMetadata(imgFilePath, authToken, reference)
        const mediaHash = uploadMetadataResp.data.data[0].split('://')[1]
        const referenceHash = uploadMetadataResp.data.data[1].split('://')[1]
        console.log(mediaHash, referenceHash)

        const tokenMetadata = {
            title: `Avatar Example ${i}`,
            media: mediaHash,
            copies: 1,
            reference: referenceHash,
        }

        const royalty = {
            [accountId] : 1000 // 10 % royalty
        }

        const params = {
            creator_id: accountId,
            token_metadata: tokenMetadata,
            // price: Option<U128>
            royalty: royalty
        }

        console.log(params)

        // call nft_create_series
        await retry(
            async () => {
                try {
                    await tokenContract.nft_create_series(
                        params,
                        '100000000000000',
                        '8540000000000000000000' // 0.00854 N
                    )
                } catch (err) {
                    if (
                        err.message === 'Transaction has expired' ||
                        err.message.includes('GatewayTimeoutError') ||
                        err.message.includes('Please try again')
                    ) {
                        throw new Error('Try again')
                    } else {
                        console.log('nft_create_series error')
                        console.log(err)
                        process.exit(1)
                    }
                }
            },
            {
                retries: 100,
                minTimeout: 500,
                maxTimeout: 1500,
            }
        )
    }
}

main()