import { PhantasmaAPI } from "phantasma-sdk-ts";

const rawRpcUrl = process.env.NEXT_PUBLIC_API_URL;
const rawNexus = process.env.NEXT_PUBLIC_PHANTASMA_NEXUS;

const RPC_URL = typeof rawRpcUrl === "string" ? rawRpcUrl.trim() : "";
const NEXUS = typeof rawNexus === "string" ? rawNexus.trim() : "";

export function createApi() {
  return new PhantasmaAPI(RPC_URL, undefined, NEXUS);
}

export { RPC_URL, NEXUS };
