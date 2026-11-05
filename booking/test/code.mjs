// Prints the current two-step code for the demo administrator:  node test/code.mjs <secret printed by the preview>
import { totp } from "../../accounts/server/crypto.js";
console.log(totp(process.argv[2]));
