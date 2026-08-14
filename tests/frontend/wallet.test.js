import test from "node:test";
import assert from "node:assert/strict";
import { makeWriteClient } from "../../src/genlayer.js";
import {
  STUDIONET_WALLET_CHAIN,
  bindProviderSession,
  connectInjectedWallet,
  createDialogBoundary,
  createWalletDiscovery,
  selectWalletProvider,
  showChooserError,
} from "../../src/wallet.js";

const ACCOUNT_A = "0x1111111111111111111111111111111111111111";
const ACCOUNT_B = "0x2222222222222222222222222222222222222222";

class FakeTarget extends EventTarget {}

test("an in-flight request keeps the provider that actually received it selected", () => {
  assert.equal(selectWalletProvider("metamask", "okx", "metamask"), "metamask");
  assert.equal(selectWalletProvider("metamask", "okx", ""), "okx");
});

function announcement(uuid, provider, name = "Test wallet") {
  const event = new Event("eip6963:announceProvider");
  Object.defineProperty(event, "detail", { value: { info: { uuid, name, icon: "data:image/svg+xml,test" }, provider } });
  return event;
}

function fakeProvider(handler = async ({ method }) => {
  if (method === "eth_requestAccounts") return [ACCOUNT_A];
  if (method === "eth_chainId") return STUDIONET_WALLET_CHAIN.chainId;
  return null;
}) {
  const calls = [];
  const listeners = new Map();
  return {
    calls,
    async request(payload) {
      calls.push(payload);
      return handler(payload, calls);
    },
    on(name, listener) {
      const group = listeners.get(name) ?? new Set();
      group.add(listener);
      listeners.set(name, group);
    },
    removeListener(name, listener) {
      listeners.get(name)?.delete(listener);
    },
    emit(name, value) {
      for (const listener of listeners.get(name) ?? []) listener(value);
    },
    listenerCount(name) {
      return listeners.get(name)?.size ?? 0;
    },
  };
}

test("discovery returns zero providers without injected wallets", () => {
  const target = new FakeTarget();
  const discovery = createWalletDiscovery(target);
  assert.deepEqual(discovery.refresh(), []);
  discovery.cleanup();
});

test("discovery accepts one valid announcement and listener precedes request", () => {
  const target = new FakeTarget();
  const provider = fakeProvider();
  target.addEventListener("eip6963:requestProvider", () => target.dispatchEvent(announcement("one", provider)));
  const discovery = createWalletDiscovery(target);
  assert.equal(discovery.refresh().length, 1);
  assert.equal(discovery.getProviders()[0].provider, provider);
  discovery.cleanup();
});

test("discovery exposes two announcements and deduplicates repeated UUID and identity", () => {
  const target = new FakeTarget();
  const first = fakeProvider();
  const second = fakeProvider();
  target.addEventListener("eip6963:requestProvider", () => {
    target.dispatchEvent(announcement("first", first, "Old name"));
    target.dispatchEvent(announcement("second", second));
    target.dispatchEvent(announcement("first", first, "Updated name"));
    target.dispatchEvent(announcement("alias", second, "Same provider"));
  });
  const discovery = createWalletDiscovery(target);
  const providers = discovery.refresh();
  assert.equal(providers.length, 2);
  assert.equal(providers.find((item) => item.provider === first).name, "Updated name");
  discovery.cleanup();
});

test("legacy provider is only a fallback and is replaced by the first announcement", () => {
  const target = new FakeTarget();
  const legacy = fakeProvider();
  const announced = fakeProvider();
  target.ethereum = legacy;
  const discovery = createWalletDiscovery(target);
  assert.equal(discovery.refresh()[0].provider, legacy);
  target.dispatchEvent(announcement("announced", announced));
  assert.deepEqual(discovery.getProviders().map((item) => item.provider), [announced]);
  discovery.cleanup();
});

test("invalid announcements are ignored", () => {
  const target = new FakeTarget();
  const discovery = createWalletDiscovery(target);
  target.dispatchEvent(announcement("", fakeProvider()));
  target.dispatchEvent(announcement("bad", {}));
  assert.deepEqual(discovery.getProviders(), []);
  discovery.cleanup();
});

test("explicit connection rejects an empty account before chain RPC", async () => {
  const provider = fakeProvider(async ({ method }) => method === "eth_requestAccounts" ? [] : null);
  await assert.rejects(connectInjectedWallet(provider), /valid account/);
  assert.deepEqual(provider.calls.map((call) => call.method), ["eth_requestAccounts"]);
});

test("rejected account connection stops without chain RPC", async () => {
  const provider = fakeProvider(async ({ method }) => {
    if (method === "eth_requestAccounts") throw Object.assign(new Error("User rejected connection"), { code: 4001 });
    return null;
  });
  await assert.rejects(connectInjectedWallet(provider), /User rejected connection/);
  assert.deepEqual(provider.calls.map((call) => call.method), ["eth_requestAccounts"]);
});

test("explicit connection switches and revalidates Studionet", async () => {
  const provider = fakeProvider();
  assert.equal(await connectInjectedWallet(provider), ACCOUNT_A);
  assert.deepEqual(provider.calls.map((call) => call.method), [
    "eth_requestAccounts",
    "wallet_switchEthereumChain",
    "eth_chainId",
  ]);
});

test("unknown chain adds Studionet and retries switch once", async () => {
  let switches = 0;
  const provider = fakeProvider(async ({ method }) => {
    if (method === "eth_requestAccounts") return [ACCOUNT_A];
    if (method === "wallet_switchEthereumChain" && switches++ === 0) throw Object.assign(new Error("unknown"), { code: 4902 });
    if (method === "eth_chainId") return "0xF22F";
    return null;
  });
  await connectInjectedWallet(provider);
  assert.deepEqual(provider.calls.map((call) => call.method), [
    "eth_requestAccounts",
    "wallet_switchEthereumChain",
    "wallet_addEthereumChain",
    "wallet_switchEthereumChain",
    "eth_chainId",
  ]);
  assert.deepEqual(provider.calls[2].params, [STUDIONET_WALLET_CHAIN]);
});

test("rejected and non-unknown switch errors never add a chain", async () => {
  for (const code of [4001, -32603]) {
    const provider = fakeProvider(async ({ method }) => {
      if (method === "eth_requestAccounts") return [ACCOUNT_A];
      if (method === "wallet_switchEthereumChain") throw Object.assign(new Error(`failure ${code}`), { code });
      return null;
    });
    await assert.rejects(connectInjectedWallet(provider), new RegExp(`failure ${code}`));
    assert.equal(provider.calls.some((call) => call.method === "wallet_addEthereumChain"), false);
  }
});

test("provider session handles account changes, removal, chain changes, and cleanup", () => {
  const provider = fakeProvider();
  const accounts = [];
  const chains = [];
  const cleanup = bindProviderSession(provider, {
    onAccountsChanged: (account) => accounts.push(account),
    onChainChanged: (chain) => chains.push(chain),
  });
  provider.emit("accountsChanged", [ACCOUNT_B]);
  provider.emit("accountsChanged", []);
  provider.emit("chainChanged", "61999");
  assert.deepEqual(accounts, [ACCOUNT_B, ""]);
  assert.deepEqual(chains, [STUDIONET_WALLET_CHAIN.chainId]);
  cleanup();
  assert.equal(provider.listenerCount("accountsChanged"), 0);
  assert.equal(provider.listenerCount("chainChanged"), 0);
});

test("chooser reports errors inline with an active alert target", () => {
  const alert = { textContent: "", hidden: true };
  showChooserError(alert, new Error("User rejected connection"));
  assert.equal(alert.textContent, "User rejected connection");
  assert.equal(alert.hidden, false);
});

class Focusable {
  constructor(document) {
    this.ownerDocument = document;
    this.hidden = false;
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
}

class FakeDialog extends EventTarget {
  constructor(items, document) {
    super();
    this.items = items;
    this.ownerDocument = document;
    this.open = false;
  }
  querySelectorAll() { return this.items; }
  contains(item) { return this.items.includes(item); }
  showModal() { this.open = true; }
  close() { this.open = false; }
}

function keyEvent(key, shiftKey = false) {
  const event = new Event("keydown", { cancelable: true });
  Object.defineProperties(event, { key: { value: key }, shiftKey: { value: shiftKey } });
  return event;
}

test("chooser traps focus, supports Escape, inerts background, and restores focus", () => {
  const document = { activeElement: null };
  const first = new Focusable(document);
  const last = new Focusable(document);
  const initiator = new Focusable(document);
  const dialog = new FakeDialog([first, last], document);
  const shell = { inert: false };
  const boundary = createDialogBoundary(dialog, shell, first);
  initiator.focus();
  boundary.open(initiator);
  assert.equal(shell.inert, true);
  assert.equal(document.activeElement, first);
  last.focus();
  assert.equal(dialog.dispatchEvent(keyEvent("Tab")), false);
  assert.equal(document.activeElement, first);
  assert.equal(dialog.dispatchEvent(keyEvent("Tab", true)), false);
  assert.equal(document.activeElement, last);
  assert.equal(dialog.dispatchEvent(keyEvent("Escape")), false);
  assert.equal(dialog.open, false);
  assert.equal(shell.inert, false);
  assert.equal(document.activeElement, initiator);
  boundary.cleanup();
});

test("closing chooser makes zero provider RPC calls", () => {
  const target = new FakeTarget();
  const provider = fakeProvider();
  target.ethereum = provider;
  const discovery = createWalletDiscovery(target);
  const document = { activeElement: null };
  const closeButton = new Focusable(document);
  const initiator = new Focusable(document);
  const dialog = new FakeDialog([closeButton], document);
  const boundary = createDialogBoundary(dialog, { inert: false }, closeButton);
  discovery.refresh();
  boundary.open(initiator);
  boundary.close();
  assert.equal(provider.calls.length, 0);
  boundary.cleanup();
  discovery.cleanup();
});

test("permitted backdrop closes the chooser and discovery cleanup removes announcements", () => {
  const target = new FakeTarget();
  const discovery = createWalletDiscovery(target);
  const document = { activeElement: null };
  const closeButton = new Focusable(document);
  const initiator = new Focusable(document);
  const dialog = new FakeDialog([closeButton], document);
  const shell = { inert: false };
  const boundary = createDialogBoundary(dialog, shell, closeButton);
  boundary.open(initiator);
  dialog.dispatchEvent(new Event("click"));
  assert.equal(dialog.open, false);
  assert.equal(shell.inert, false);
  discovery.cleanup();
  target.dispatchEvent(announcement("late", fakeProvider()));
  assert.deepEqual(discovery.getProviders(), []);
  boundary.cleanup();
});

test("write client is constructed with the exact selected provider and account", async () => {
  const selected = fakeProvider();
  const globalProvider = fakeProvider();
  globalThis.ethereum = globalProvider;
  let captured;
  const client = await makeWriteClient(selected, ACCOUNT_A, (options) => {
    captured = options;
    return { connect: async () => {} };
  });
  assert.ok(client);
  assert.equal(captured.provider, selected);
  assert.equal(captured.account, ACCOUNT_A);
  assert.notEqual(captured.provider, globalThis.ethereum);
  delete globalThis.ethereum;
});
