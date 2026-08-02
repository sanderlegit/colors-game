#!/usr/bin/env node
/**
 * The URL this machine is reachable at on the tailnet, or a diagnosis of why it
 * is not.
 *
 * `just tailnet` needs the node's MagicDNS name for two things: to print
 * something you can type into a phone, and to fail *before* `tailscale serve`
 * does, with a sentence that says which of the four preconditions is missing.
 * `tailscale serve` itself reports a missing HTTPS certificate as a TLS error
 * several seconds in, by which point the stack is already up.
 *
 * The name is read from `tailscale status --json` rather than assembled from a
 * hostname and a tailnet: `Self.DNSName` is the name the certificate is issued
 * for, and it is the only spelling the browser will accept without a warning.
 *
 * `--ip` prints the tailnet IPv4 instead, for the address-based path
 * (ADR 0020 § The second way in). It deliberately does not require a MagicDNS
 * name: not having one that resolves is the entire reason that path exists.
 *
 * Usage:
 *   node scripts/tailnet-url.mjs [--ip] [--port 7443]
 *
 * Prints an origin — `https://host.tailnet.ts.net:7443` — and nothing else, so
 * it can be captured in a shell substitution. Diagnoses go to stderr.
 */

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = portIndex === -1 ? "443" : args[portIndex + 1];
const wantIp = args.includes("--ip");

if (!/^\d+$/.test(port ?? "")) {
  fail("--port needs a number.");
}

const result = spawnSync("tailscale", ["status", "--json"], { encoding: "utf8" });

if (result.error?.code === "ENOENT") {
  fail("tailscale is not installed. https://tailscale.com/download");
}
if (result.status !== 0) {
  fail(`tailscale status failed: ${(result.stderr || "").trim() || `exit ${result.status}`}`);
}

let status;
try {
  status = JSON.parse(result.stdout);
} catch {
  fail("tailscale status did not return JSON.");
}

if (status.BackendState !== "Running") {
  fail(`tailscaled is ${status.BackendState ?? "not running"}. Run: tailscale up`);
}

const host = wantIp ? tailnetIpv4() : magicDnsName();

process.stdout.write(port === "443" ? `https://${host}\n` : `https://${host}:${port}\n`);

/**
 * A node with MagicDNS disabled has no name a certificate can be issued for, and
 * `tailscale serve --https` is what will not work. The IP is not a substitute
 * *there* — certificates are issued for the name — which is why the IP path uses
 * a TCP forward and a different certificate entirely.
 *
 * @returns {string}
 */
function magicDnsName() {
  const dnsName = (status.Self?.DNSName ?? "").replace(/\.$/, "");
  if (dnsName === "") {
    fail("This node has no MagicDNS name. Enable MagicDNS and HTTPS in the admin console.");
  }
  return dnsName;
}

/** @returns {string} */
function tailnetIpv4() {
  const ipv4 = (status.Self?.TailscaleIPs ?? []).find((ip) => ip.includes("."));
  if (ipv4 === undefined) {
    fail("This node has no tailnet IPv4 address.");
  }
  return ipv4;
}

/** @param {string} message @returns {never} */
function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
