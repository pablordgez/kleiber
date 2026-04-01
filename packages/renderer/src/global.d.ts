import type { KleiberApi } from "../../preload/src/index";

declare global {
  interface Window {
    kleiber: KleiberApi;
  }
}

export {};
