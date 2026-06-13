import { CryptoControlAPI } from "@crypto-control/core";

declare global {
  interface Window {
    cryptoControl: CryptoControlAPI;
  }
}
