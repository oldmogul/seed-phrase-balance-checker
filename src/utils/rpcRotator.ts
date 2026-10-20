type EndpointState = {
  url: string;
  failCount: number;
  cooldownUntil: number;
};

export class RpcRotator {
  private endpoints: EndpointState[];
  private index = 0;

  constructor(urls: string[]) {
    this.endpoints = urls.map((url) => ({
      url,
      failCount: 0,
      cooldownUntil: 0,
    }));
  }

  getNext(): string {
    const now = Date.now();
    const total = this.endpoints.length;

    for (let i = 0; i < total; i++) {
      const ep = this.endpoints[this.index % total];
      this.index++;

      if (ep.cooldownUntil <= now) {
        return ep.url;
      }
    }

    // All cooling down → pick the one that recovers soonest
    const sorted = [...this.endpoints].sort(
      (a, b) => a.cooldownUntil - b.cooldownUntil
    );
    return sorted[0].url;
  }

  reportSuccess(url: string) {
    const ep = this.endpoints.find((e) => e.url === url);
    if (ep) {
      ep.failCount = 0;
      ep.cooldownUntil = 0;
    }
  }

  report429(url: string) {
    const ep = this.endpoints.find((e) => e.url === url);
    if (!ep) return;

    ep.failCount++;

    if (ep.failCount >= 2) {
      const cooldownMs = Math.min(ep.failCount * 45_000, 5 * 60_000); // max 5 min
      ep.cooldownUntil = Date.now() + cooldownMs;
      console.log(
        `[RPC] ${url} too many 429s → cooldown ${Math.round(cooldownMs / 1000)}s`
      );
    }
  }
}