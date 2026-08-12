const providers = new Map();
let listening = false;

function fallbackName(provider, index) {
  if (provider?.isMetaMask) return "MetaMask";
  if (provider?.isCoinbaseWallet) return "Coinbase Wallet";
  if (provider?.isBraveWallet) return "Brave Wallet";
  return `Injected wallet ${index + 1}`;
}

function addProvider(id, name, provider, icon = "") {
  if (!provider || typeof provider.request !== "function") return;
  providers.set(id, { id, name, provider, icon });
}

export function discoverWalletProviders(target = window) {
  if (!listening) {
    target.addEventListener("eip6963:announceProvider", (event) => {
      const { info, provider } = event.detail ?? {};
      if (info?.uuid) addProvider(info.uuid, info.name || "Browser wallet", provider, info.icon || "");
    });
    listening = true;
  }
  target.dispatchEvent(new Event("eip6963:requestProvider"));

  const injected = target.ethereum?.providers ?? (target.ethereum ? [target.ethereum] : []);
  injected.forEach((provider, index) => addProvider(`injected-${index}`, fallbackName(provider, index), provider));
  return [...providers.values()];
}

export async function requestWalletAccount(provider) {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const account = Array.isArray(accounts) ? accounts[0] : "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(account ?? "")) throw new Error("The selected wallet did not return a valid account.");
  return account;
}
