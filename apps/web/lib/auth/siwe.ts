import { apiGet, apiPost } from "../api";

export type SiweNonceResponse = {
  nonce: string;
  expiresAt: string;
};

export type SiweVerifyResponse = {
  ok: boolean;
  user?: {
    id: string;
    email: string;
    walletAddress?: string | null;
  };
};

export function buildSiweMessage(input: {
  domain: string;
  address: string;
  uri: string;
  chainId: number;
  nonce: string;
  statement?: string;
  issuedAt?: string;
}): string {
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  const statement = input.statement ?? "Sign in to uTrade";

  return [
    `${input.domain} wants you to sign in with your Ethereum account:`,
    input.address,
    "",
    statement,
    "",
    `URI: ${input.uri}`,
    "Version: 1",
    `Chain ID: ${input.chainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${issuedAt}`
  ].join("\n");
}

export async function fetchSiweNonce(): Promise<SiweNonceResponse> {
  return apiGet<SiweNonceResponse>("/auth/siwe/nonce");
}

export async function verifySiweLogin(input: { message: string; signature: string }): Promise<SiweVerifyResponse> {
  return apiPost<SiweVerifyResponse>("/auth/siwe/verify", input);
}

export async function linkSiweWallet(input: { message: string; signature: string }): Promise<{ ok: boolean; walletAddress?: string }> {
  return apiPost<{ ok: boolean; walletAddress?: string }>("/auth/siwe/link", input);
}

export function shortenWalletAddress(value: string | null | undefined): string {
  const address = String(value ?? "").trim();
  if (!address) return "";
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
