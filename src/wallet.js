const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const TARGET_CHAIN_ID = "0xf22f";

export const STUDIONET_WALLET_CHAIN = Object.freeze({
  chainId: TARGET_CHAIN_ID,
  chainName: "GenLayer Studionet",
  nativeCurrency: Object.freeze({ name: "GEN", symbol: "GEN", decimals: 18 }),
  rpcUrls: Object.freeze(["https://studio.genlayer.com/api"]),
  blockExplorerUrls: Object.freeze(["https://explorer-studio.genlayer.com"]),
});

function validProvider(provider) {
  return Boolean(provider && typeof provider === "object" && typeof provider.request === "function");
}

function safeLabel(value, fallback) {
  const label = typeof value === "string" ? value.trim() : "";
  return label && label.length <= 100 ? label : fallback;
}

function validUuid(value) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 128;
}

const KNOWN_PROVIDER_NAMES = new Map([
  ["com.okex.wallet", "OKX Wallet"],
  ["io.metamask", "MetaMask"],
  ["app.phantom", "Phantom"],
]);

function providerIdentityMarkers(provider) {
  try {
    return [
      provider.isOkxWallet || provider.isOKExWallet ? "com.okex.wallet" : "",
      provider.isMetaMask ? "io.metamask" : "",
      provider.isPhantom ? "app.phantom" : "",
    ].filter(Boolean);
  } catch {
    return ["unreadable-provider-identity"];
  }
}

function validAnnouncedIdentity(rdns, markers) {
  if (markers.includes("unreadable-provider-identity") || new Set(markers).size > 1) return false;
  return markers.length === 0 || !KNOWN_PROVIDER_NAMES.has(rdns) || markers[0] === rdns;
}

export function createDisconnectedWalletSession() {
  return { account: "", selectedProvider: null, writeClient: null };
}

export function createWalletDiscovery(target = window, onChange = () => {}, fallbackDelayMs = 150) {
  const options = new Map();
  const uuidToId = new Map();
  const fallbackId = "legacy-injected-provider";
  let nextId = 1;
  let cleanedUp = false;
  let fallbackTimer;

  const notify = () => onChange([...options.values()]);
  const findProviderId = (provider) => [...options].find(([, option]) => option.provider === provider)?.[0];
  const clearFallbackTimer = () => {
    if (fallbackTimer === undefined) return;
    clearTimeout(fallbackTimer);
    fallbackTimer = undefined;
  };
  const rebuildUuidIndex = () => {
    uuidToId.clear();
    for (const [id, option] of options) if (option.uuid) uuidToId.set(option.uuid, id);
  };

  const announce = (event) => {
    if (cleanedUp) return;
    const { info, provider } = event?.detail ?? {};
    if (!validUuid(info?.uuid) || !validProvider(provider)) return;
    const rdns = safeLabel(info.rdns, "").toLowerCase();
    const identityMarkers = providerIdentityMarkers(provider);
    if (!validAnnouncedIdentity(rdns, identityMarkers)) return;

    clearFallbackTimer();
    options.delete(fallbackId);
    const uuid = info.uuid.trim();
    const uuidId = uuidToId.get(uuid);
    const providerId = findProviderId(provider);
    if (uuidId && options.get(uuidId)?.provider !== provider) return;
    if (providerId && options.get(providerId)?.uuid !== uuid) return;
    const id = uuidId ?? providerId ?? `announced-provider-${nextId++}`;
    const previous = options.get(id);
    if (previous?.rdns && rdns && previous.rdns !== rdns) return;
    const option = {
      id,
      uuid,
      name: KNOWN_PROVIDER_NAMES.get(rdns) ?? "Browser wallet",
      rdns,
      icon: typeof info.icon === "string" && info.icon.length <= 100_000 ? info.icon : "",
      provider,
      identityMarkers,
      callLedger: previous?.callLedger ?? [],
    };
    options.set(id, option);
    if (previous?.uuid && previous.uuid !== uuid) uuidToId.delete(previous.uuid);
    rebuildUuidIndex();
    notify();
  };

  target.addEventListener("eip6963:announceProvider", announce);

  function refresh() {
    if (cleanedUp) return [];
    clearFallbackTimer();
    target.dispatchEvent(new Event("eip6963:requestProvider"));
    if (options.size === 0) {
      fallbackTimer = setTimeout(() => {
        fallbackTimer = undefined;
        if (cleanedUp || options.size > 0 || !validProvider(target.ethereum)) return;
        options.set(fallbackId, {
          id: fallbackId,
          uuid: "",
          name: "Injected wallet",
          rdns: "",
          icon: "",
          provider: target.ethereum,
          identityMarkers: [],
          callLedger: [],
        });
        notify();
      }, fallbackDelayMs);
    }
    return [...options.values()];
  }

  return {
    refresh,
    getProviders: () => [...options.values()],
    cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      clearFallbackTimer();
      target.removeEventListener("eip6963:announceProvider", announce);
      options.clear();
    },
  };
}

export function normalizeChainId(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return `0x${value.toString(16)}`;
  if (typeof value !== "string" || !/^(0x[0-9a-f]+|[0-9]+)$/i.test(value.trim())) return "";
  try {
    return `0x${BigInt(value.trim()).toString(16)}`;
  } catch {
    return "";
  }
}

export function selectWalletProvider(currentId, requestedId, connectingProviderId = "") {
  return connectingProviderId ? currentId : requestedId;
}

function errorCode(error) {
  return error?.code ?? error?.data?.originalError?.code ?? error?.cause?.code;
}

export async function connectInjectedWallet(provider, chain = STUDIONET_WALLET_CHAIN, callLedger = []) {
  if (!validProvider(provider)) throw new Error("The selected wallet provider is unavailable.");
  const request = (payload) => {
    callLedger.push(payload.method);
    return provider.request(payload);
  };
  const accounts = await request({ method: "eth_requestAccounts" });
  const account = Array.isArray(accounts) ? accounts[0] : "";
  if (!ADDRESS_PATTERN.test(account ?? "")) throw new Error("The selected wallet did not return a valid account.");

  try {
    await request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.chainId }] });
  } catch (error) {
    if (Number(errorCode(error)) !== 4902) throw error;
    await request({ method: "wallet_addEthereumChain", params: [chain] });
    await request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.chainId }] });
  }

  const activeChainId = normalizeChainId(await request({ method: "eth_chainId" }));
  if (activeChainId !== normalizeChainId(chain.chainId)) {
    throw new Error("The selected wallet did not activate GenLayer Studionet.");
  }
  return account;
}

export function bindProviderSession(provider, handlers = {}) {
  if (!provider || typeof provider.on !== "function") return () => {};
  const accountsChanged = (accounts) => {
    const account = Array.isArray(accounts) && ADDRESS_PATTERN.test(accounts[0] ?? "") ? accounts[0] : "";
    handlers.onAccountsChanged?.(account);
  };
  const chainChanged = (chainId) => handlers.onChainChanged?.(normalizeChainId(chainId));
  provider.on("accountsChanged", accountsChanged);
  provider.on("chainChanged", chainChanged);
  return () => {
    if (typeof provider.removeListener !== "function") return;
    provider.removeListener("accountsChanged", accountsChanged);
    provider.removeListener("chainChanged", chainChanged);
  };
}

export function showChooserError(element, error) {
  const candidates = [
    error?.message,
    error?.error?.message,
    error?.data?.message,
    error?.data?.originalError?.message,
    error?.cause?.message,
  ];
  const message = candidates.find((value) => typeof value === "string" && value.trim())
    ?? (typeof error === "string" && error.trim() ? error : "Wallet connection failed. Retry or choose another announced provider.");
  element.textContent = message;
  element.hidden = false;
}

export function createDialogBoundary(dialog, appShell, initialFocus) {
  let returnFocus = null;
  const focusableSelector = "button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";
  const focusable = () => [...dialog.querySelectorAll(focusableSelector)].filter((element) => !element.hidden);

  const close = () => {
    if (!dialog.open) return;
    dialog.close();
    appShell.inert = false;
    returnFocus?.focus?.();
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusable();
    if (items.length === 0) return event.preventDefault();
    const first = items[0];
    const last = items.at(-1);
    const active = dialog.ownerDocument.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
  const onCancel = (event) => {
    event.preventDefault();
    close();
  };
  const onClick = (event) => {
    if (event.target === dialog) close();
  };
  dialog.addEventListener("keydown", onKeyDown);
  dialog.addEventListener("cancel", onCancel);
  dialog.addEventListener("click", onClick);

  return {
    open(initiator) {
      returnFocus = initiator;
      appShell.inert = true;
      dialog.showModal();
      initialFocus.focus();
    },
    close,
    cleanup() {
      dialog.removeEventListener("keydown", onKeyDown);
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("click", onClick);
      if (dialog.open) close();
    },
  };
}
