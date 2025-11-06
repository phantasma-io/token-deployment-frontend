import { PhantasmaAPI } from "phantasma-sdk-ts";

const RPC_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5172/rpc";
const NEXUS = (process.env.NEXT_PUBLIC_PHANTASMA_NEXUS as string) || "testnet";

export function createApi() {
  return new PhantasmaAPI(RPC_URL, undefined, NEXUS);
}

export { RPC_URL, NEXUS };

