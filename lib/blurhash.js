const sharp = require("sharp");
const { encode } = require("blurhash");

const encodeImageToBlurhash = path =>
    new Promise((resolve, reject) => {
        sharp(path)
            .raw()
            .ensureAlpha()
            .resize(32, 32, { fit: "inside" })
            .toBuffer((err, buffer, { width, height }) => {
                if (err) return reject(err);
                resolve(encode(new Uint8ClampedArray(buffer), width, height, 4, 4));
            });
    });

exports.encodeImageToBlurhash = encodeImageToBlurhash