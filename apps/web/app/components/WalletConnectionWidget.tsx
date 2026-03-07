"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useConnection, useSwitchChain } from "wagmi";
import { TARGET_CHAIN_ID, TARGET_CHAIN_NAME, isWeb3ModalReady } from "../../lib/web3/config";
import { getWeb3ModalInitState, initWeb3Modal, openWeb3Modal } from "../../lib/web3/modal";

function WalletConnectionWidgetContent({ modalReady }: { modalReady: boolean }) {
  const tWallet = useTranslations("nav.header.wallet");
  const connection = useConnection();
  const {
    mutateAsync: switchChain,
    isPending: isSwitchPending
  } = useSwitchChain();

  const isConnected = connection.isConnected;
  const hasChainMismatch = isConnected && connection.chainId !== TARGET_CHAIN_ID;

  async function handlePrimaryAction() {
    if (!modalReady) return;
    if (hasChainMismatch) {
      try {
        await switchChain({ chainId: TARGET_CHAIN_ID });
        return;
      } catch {
        await openWeb3Modal({ view: "Networks" });
        return;
      }
    }

    await openWeb3Modal({ view: "Connect" });
  }

  const buttonLabel = !isConnected
    ? tWallet("connectWallet")
    : hasChainMismatch
      ? tWallet("switchToHyperEvm")
      : tWallet("statusConnected");

  const buttonTitle = hasChainMismatch ? tWallet("wrongNetwork", { chain: TARGET_CHAIN_NAME }) : undefined;

  return (
    <button
      type="button"
      className="btn"
      title={buttonTitle}
      onClick={() => void handlePrimaryAction()}
      disabled={!modalReady || !isWeb3ModalReady || isSwitchPending}
    >
      {buttonLabel}
    </button>
  );
}

export default function WalletConnectionWidget() {
  const [modalInitState, setModalInitState] = useState(() => getWeb3ModalInitState());

  useEffect(() => {
    if (!isWeb3ModalReady || modalInitState.initialized) return;
    void initWeb3Modal().then((state) => {
      setModalInitState(state);
    });
  }, [modalInitState.initialized]);

  const modalReady = isWeb3ModalReady && modalInitState.initialized;
  return <WalletConnectionWidgetContent modalReady={modalReady} />;
}
