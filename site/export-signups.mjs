#!/usr/bin/env node
// Prints every signup as CSV. Uses your gcloud login: `node site/export-signups.mjs > signups.csv`
import { execSync } from "node:child_process";

const PROJECT = process.env.PROJECT ?? "kronagent";
const DATABASE = process.env.FIRESTORE_DATABASE ?? "recap";
const token = execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/documents/signups`;

const val = (f) => f?.stringValue ?? f?.timestampValue ?? f?.integerValue ?? "";
const csv = (s) => (/[",\n]/.test(s) ? `"${String(s).replaceAll('"', '""')}"` : s);

const rows = [];
let pageToken = "";
do {
  const res = await fetch(`${base}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ""}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Firestore ${res.status}: ${await res.text()}`);
  const page = await res.json();
  for (const d of page.documents ?? []) rows.push(d.fields);
  pageToken = page.nextPageToken ?? "";
} while (pageToken);

rows.sort((a, b) => val(a.createdAt).localeCompare(val(b.createdAt)));
console.log("email,interest,createdAt,lastSeenAt,signups,source,referrer");
for (const f of rows) {
  console.log([val(f.email), val(f.interest), val(f.createdAt), val(f.lastSeenAt), val(f.signups), val(f.source), val(f.referrer)].map(csv).join(","));
}
console.error(`${rows.length} signup(s)`);
