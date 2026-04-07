export function getPhantomProvider() {
  if (typeof window === 'undefined') return null;

  const injected = window.phantom?.solana;
  if (injected?.isPhantom) return injected;

  const sol = window.solana;
  if (sol?.isPhantom) return sol;

  if (Array.isArray(sol?.providers)) {
    return sol.providers.find((provider) => provider?.isPhantom) || null;
  }

  return null;
}

export async function connectPhantom({ onlyIfTrusted = false } = {}) {
  const provider = getPhantomProvider();
  if (!provider) {
    throw new Error('Phantom not detected.');
  }

  if (provider.isConnected && provider.publicKey) {
    return { provider, publicKey: provider.publicKey };
  }

  const result = onlyIfTrusted
    ? await provider.connect({ onlyIfTrusted: true }).catch(() => null)
    : await provider.connect();

  return {
    provider,
    publicKey: result?.publicKey || provider.publicKey || null,
  };
}

export async function disconnectPhantom() {
  const provider = getPhantomProvider();
  if (!provider?.disconnect) return;
  await provider.disconnect();
}
