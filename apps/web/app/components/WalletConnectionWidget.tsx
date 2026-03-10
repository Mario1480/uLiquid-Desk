"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { switchChain } from "wagmi/actions";
import { TARGET_CHAIN, TARGET_CHAIN_ID, TARGET_CHAIN_NAME, isWeb3ModalReady, wagmiConfig } from "../../lib/web3/config";
import { getWeb3ModalInitState, initWeb3Modal, openWeb3Modal } from "../../lib/web3/modal";

function shortAddress(value: string | undefined): string {
  if (!value) return "";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M7 10l5 5 5-5" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function WalletConnectionWidgetContent({ modalReady }: { modalReady: boolean }) {
  const tWallet = useTranslations("nav.header.wallet");
  const { address, chainId, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const [isSwitchPending, setIsSwitchPending] = useState(false);
  const [isDisconnectPending, setIsDisconnectPending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const hasChainMismatch = isConnected && chainId !== TARGET_CHAIN_ID;

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!anchorRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  async function handlePrimaryAction() {
    if (!modalReady) return;
    if (hasChainMismatch) {
      setIsSwitchPending(true);
      try {
        await switchChain(wagmiConfig, { chainId: TARGET_CHAIN_ID });
        return;
      } catch {
        await openWeb3Modal({ view: "Networks" });
        return;
      } finally {
        setIsSwitchPending(false);
      }
    }
    if (!isConnected) {
      await openWeb3Modal({ view: "Connect" });
      return;
    }
    setMenuOpen((current) => !current);
  }

  async function handleDisconnect() {
    setIsDisconnectPending(true);
    try {
      disconnect();
      setMenuOpen(false);
    } finally {
      setIsDisconnectPending(false);
    }
  }

  async function handleSwitchFromMenu() {
    try {
      setMenuOpen(false);
      await switchChain(wagmiConfig, { chainId: TARGET_CHAIN_ID });
    } catch {
      await openWeb3Modal({ view: "Networks" });
    }
  }

  async function handleCopyAddress() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  const buttonLabel = !isConnected
    ? tWallet("connectWallet")
    : hasChainMismatch
      ? tWallet("switchToHyperEvm")
      : shortAddress(address);

  const buttonTitle = hasChainMismatch ? tWallet("wrongNetwork", { chain: TARGET_CHAIN_NAME }) : undefined;
  const explorerUrl = address && TARGET_CHAIN.blockExplorers?.default?.url
    ? `${TARGET_CHAIN.blockExplorers.default.url.replace(/\/$/, "")}/address/${address}`
    : null;

  return (
    <div ref={anchorRef} className="appHeaderMenuAnchor">
      <button
        type="button"
        className={`appHeaderWalletTrigger ${
          isConnected
            ? hasChainMismatch
              ? "appHeaderWalletButtonWarning"
              : "appHeaderWalletButtonConnected"
            : ""
        } ${menuOpen ? "appHeaderWalletTriggerOpen" : ""}`}
        title={buttonTitle}
        onClick={() => void handlePrimaryAction()}
        disabled={!modalReady || !isWeb3ModalReady || isSwitchPending || isDisconnectPending}
        aria-haspopup={isConnected ? "menu" : undefined}
        aria-expanded={isConnected ? menuOpen : undefined}
      >
        <span className="appHeaderWalletTriggerLabel">{buttonLabel}</span>
        {isConnected ? <span className="appHeaderChevron" aria-hidden="true"><ChevronIcon /></span> : null}
      </button>
      {isConnected && menuOpen ? (
        <div className="appHeaderMenuPanel appHeaderWalletPanel" role="menu">
          <div className="appHeaderMenuTitleRow">
            <div className="appHeaderMenuTitle">{tWallet("walletTitle")}</div>
            <span className={`badge ${hasChainMismatch ? "badgeWarn" : "badgeOk"}`}>
              {hasChainMismatch ? tWallet("statusWrongNetwork") : tWallet("statusConnected")}
            </span>
          </div>
          <div className="appHeaderWalletPanelMeta">
            <div className="appHeaderWalletPanelLabel">{tWallet("address")}</div>
            <div className="appHeaderWalletPanelValueRow">
              <div className="appHeaderWalletPanelValue">{address}</div>
              <button
                type="button"
                className="appHeaderWalletCopyButton"
                onClick={() => void handleCopyAddress()}
                title={copied ? tWallet("copied") : tWallet("copyAddress")}
                aria-label={copied ? tWallet("copied") : tWallet("copyAddress")}
              >
                <CopyIcon />
              </button>
            </div>
          </div>
          <div className="appHeaderWalletPanelMeta">
            <div className="appHeaderWalletPanelLabel">{tWallet("chain")}</div>
            <div className="appHeaderWalletPanelValue">{hasChainMismatch ? `${chainId} -> ${TARGET_CHAIN_NAME}` : TARGET_CHAIN_NAME}</div>
          </div>
          {explorerUrl ? (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="appHeaderMenuLink"
              onClick={() => setMenuOpen(false)}
            >
              <span>{tWallet("address")}</span>
              <span className="appHeaderWalletPanelLink">{tWallet("explorer")}</span>
            </a>
          ) : null}
          {hasChainMismatch ? (
            <button
              type="button"
              className="appHeaderMenuLink"
              onClick={() => void handleSwitchFromMenu()}
              disabled={isSwitchPending}
              role="menuitem"
            >
              <span>{isSwitchPending ? tWallet("statusSwitching") : tWallet("switchToHyperEvm")}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="appHeaderMenuLink appHeaderMenuLinkDanger"
            onClick={() => void handleDisconnect()}
            disabled={isDisconnectPending || isSwitchPending}
            role="menuitem"
          >
            <span>{isDisconnectPending ? tWallet("statusDisconnecting") : tWallet("disconnect")}</span>
          </button>
        </div>
      ) : null}
    </div>
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
