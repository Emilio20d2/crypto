import { FullCryptoControlAPI } from "@crypto-control/core";

declare global {
  interface Window {
    cryptoControl: FullCryptoControlAPI;
  }
}
