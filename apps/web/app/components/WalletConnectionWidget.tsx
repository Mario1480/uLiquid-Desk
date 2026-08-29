"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { switchChain } from "wagmi/actions";
import { HEADER_SWITCH_CHAINS, SUPPORTED_CHAINS, isWeb3ModalReady, wagmiConfig } from "../../lib/web3/config";
import { getWeb3ModalInitState, openWeb3Modal } from "../../lib/web3/modal";
import { AppIcon } from "./AppIcon";
import Web3Providers from "./Web3Providers";

function shortAddress(value: string | undefined): string {
  if (!value) return "";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function WalletConnectionWidgetContent({
  modalReady,
  onModalStateChange
}: {
  modalReady: boolean;
  onModalStateChange: () => void;
}) {
  const tWallet = useTranslations("nav.header.wallet");
  const { address, chainId, isConnected } = useAccount();
  const { connectors, connectAsync, isPending: isConnectPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [isSwitchPending, setIsSwitchPending] = useState(false);
  const [isDisconnectPending, setIsDisconnectPending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const activeChain = SUPPORTED_CHAINS.find((chain) => chain.id === chainId) ?? null;
  const hasUnsupportedChain = isConnected && !activeChain;
  const announcedMetaMaskConnector = connectors.find((connector) =>
    connector.id === "io.metamask" ||
    (typeof connector.rdns === "string"
      ? connector.rdns === "io.metamask"
      : connector.rdns?.includes("io.metamask"))
  );
  const classicMetaMaskConnector = connectors.find((connector) =>
    connector.id === "metaMask" || connector.name.toLowerCase() === "metamask"
  );
  const injectedConnector = announcedMetaMaskConnector ??
    classicMetaMaskConnector ??
    connectors.find((connector) => connector.type === "injected");

  useEffect(() => {
    if (!menuOpen) return;

    const focusFrame = window.requestAnimationFrame(() => panelRef.current?.focus());

    function handlePointerDown(event: MouseEvent) {
      if (!anchorRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  async function handlePrimaryAction() {
    if (!isConnected) {
      setConnectionError(null);
      if (modalReady) {
        try {
          await openWeb3Modal({ view: "Connect" });
          return;
        } catch {
          onModalStateChange();
        }
      }
      if (!injectedConnector) {
        setConnectionError(tWallet("noInjectedWallet"));
        setMenuOpen(true);
        return;
      }
      try {
        await connectAsync({ connector: injectedConnector });
        setMenuOpen(false);
      } catch {
        setConnectionError(tWallet("connectFailed"));
        setMenuOpen(true);
      }
      return;
    }
    setConnectionError(null);
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

  async function handleSwitchFromMenu(targetChainId: number) {
    try {
      setIsSwitchPending(true);
      await switchChain(wagmiConfig, { chainId: targetChainId as any });
    } catch {
      if (modalReady) {
        await openWeb3Modal({ view: "Networks" }).finally(onModalStateChange);
      }
    } finally {
      setIsSwitchPending(false);
    }
  }

  async function handleCopyAddress() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  const buttonLabel = isConnectPending
    ? tWallet("statusConnecting")
    : !isConnected
    ? tWallet("connectWallet")
    : shortAddress(address);

  const buttonTitle = connectionError ?? (hasUnsupportedChain ? tWallet("statusWrongNetwork") : activeChain?.name);
  const explorerUrl = address && activeChain?.blockExplorers?.default?.url
    ? `${activeChain.blockExplorers.default.url.replace(/\/$/, "")}/address/${address}`
    : null;
  const isButtonDisabled = isConnectPending || isSwitchPending || isDisconnectPending || (!isConnected && !modalReady && !injectedConnector);

  return (
    <div ref={anchorRef} className="appHeaderMenuAnchor">
      <button
        ref={triggerRef}
        type="button"
        className={`appHeaderWalletTrigger ${
          isConnected
            ? hasUnsupportedChain
              ? "appHeaderWalletButtonWarning"
              : "appHeaderWalletButtonConnected"
            : ""
        } ${menuOpen ? "appHeaderWalletTriggerOpen" : ""}`}
        title={buttonTitle}
        aria-label={buttonLabel}
        onClick={() => void handlePrimaryAction()}
        disabled={isButtonDisabled}
        aria-haspopup={isConnected || connectionError ? "dialog" : undefined}
        aria-expanded={isConnected || connectionError ? menuOpen : undefined}
      >
        <span className="appHeaderWalletIcon" aria-hidden="true"><AppIcon name="wallet" /></span>
        <span className="appHeaderWalletTriggerLabel">{buttonLabel}</span>
        {isConnected ? (
          <span className="appHeaderChevron" aria-hidden="true"><AppIcon name="chevronDown" /></span>
        ) : null}
      </button>
      {!isConnected && connectionError && menuOpen ? (
        <div
          ref={panelRef}
          className="appHeaderMenuPanel appHeaderWalletPanel"
          role="dialog"
          aria-label={tWallet("walletTitle")}
          tabIndex={-1}
        >
          <div className="appHeaderMenuTitleRow">
            <div className="appHeaderMenuTitle">{tWallet("walletTitle")}</div>
            <span className="badge badgeWarn">{tWallet("statusDisconnected")}</span>
          </div>
          <div className="appHeaderWalletPanelMeta" role="alert">{connectionError}</div>
        </div>
      ) : null}
      {isConnected && menuOpen ? (
        <div
          ref={panelRef}
          className="appHeaderMenuPanel appHeaderWalletPanel"
          role="dialog"
          aria-label={tWallet("walletTitle")}
          tabIndex={-1}
        >
          <div className="appHeaderMenuTitleRow">
            <div className="appHeaderMenuTitle">{tWallet("walletTitle")}</div>
            <span className={`badge ${hasUnsupportedChain ? "badgeWarn" : "badgeOk"}`}>
              {hasUnsupportedChain ? tWallet("statusWrongNetwork") : tWallet("statusConnected")}
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
                <AppIcon name="copy" />
              </button>
            </div>
          </div>
          <div className="appHeaderWalletPanelMeta">
            <div className="appHeaderWalletPanelLabel">{tWallet("chain")}</div>
            <div className="appHeaderWalletPanelValue">{activeChain?.name ?? chainId ?? tWallet("statusWrongNetwork")}</div>
          </div>
          {explorerUrl ? (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="appHeaderMenuLink"
              onClick={() => setMenuOpen(false)}
            >
              <span className="appHeaderMenuIcon" aria-hidden="true"><AppIcon name="external" /></span>
              <span>{tWallet("address")}</span>
              <span className="appHeaderWalletPanelLink">{tWallet("explorer")}</span>
            </a>
          ) : null}
          {HEADER_SWITCH_CHAINS.map((chain) => {
            const isCurrent = chain.id === chainId;
            return (
              <button
                type="button"
                className="appHeaderMenuLink"
                key={chain.id}
                onClick={() => void handleSwitchFromMenu(chain.id)}
                disabled={isSwitchPending || isCurrent}
              >
                <span className="appHeaderMenuIcon" aria-hidden="true"><AppIcon name="switch" /></span>
                <span>{isCurrent ? chain.name : tWallet("switchNetwork", { chain: chain.name })}</span>
                {isCurrent ? <span className="badge badgeOk">{tWallet("statusConnected")}</span> : null}
              </button>
            );
          })}
          <button
            type="button"
            className="appHeaderMenuLink appHeaderMenuLinkDanger"
            onClick={() => void handleDisconnect()}
            disabled={isDisconnectPending || isSwitchPending}
          >
            <span className="appHeaderMenuIcon" aria-hidden="true"><AppIcon name="logout" /></span>
            <span>{isDisconnectPending ? tWallet("statusDisconnecting") : tWallet("disconnect")}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function WalletConnectionWidget() {
  return (
    <Web3Providers>
      <WalletConnectionWidgetInner />
    </Web3Providers>
  );
}

function WalletConnectionWidgetInner() {
  const [modalInitState, setModalInitState] = useState(() => getWeb3ModalInitState());

  function refreshModalState() {
    setModalInitState(getWeb3ModalInitState());
  }

  const modalReady = isWeb3ModalReady && !modalInitState.error;
  return <WalletConnectionWidgetContent modalReady={modalReady} onModalStateChange={refreshModalState} />;
}
