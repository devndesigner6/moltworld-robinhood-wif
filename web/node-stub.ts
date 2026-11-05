// Stands in for Node's crypto/util inside algokit-utils' HD-wallet module, which the
// payment path never calls. Anything that does reach it fails loudly instead of silently.
const unavailable = (name: string) => () => {
  throw new Error(`${name} is not available in the browser bundle.`);
};

export const createHash = unavailable("crypto.createHash");
export const createHmac = unavailable("crypto.createHmac");
export const inspect = unavailable("util.inspect");
export default {};
