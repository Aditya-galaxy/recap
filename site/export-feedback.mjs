#!/usr/bin/env node
// Prints all feedback, newest first. Uses your gcloud login: `node site/export-feedback.mjs`
import { execSync } from "node:child_process";

const token = execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
const base = `https://firestore.googleapis.com/v1/projects/${process.env.PROJECT ?? "kronagent"}/databases/${process.env.FIRESTORE_DATABASE ?? "recap"}/documents/feedback`;
const v = (f) => f?.stringValue ?? f?.timestampValue ?? "";

const items = [];
let pageToken = "";
do {
  const res = await fetch(`${base}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ""}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Firestore ${res.status}: ${await res.text()}`);
  const page = await res.json();
  items.push(...(page.documents ?? []).map((d) => d.fields));
  pageToken = page.nextPageToken ?? "";
} while (pageToken);

items.sort((a, b) => v(b.createdAt).localeCompare(v(a.createdAt)));
for (const f of items) {
  console.log(`── ${v(f.createdAt).slice(0, 16).replace("T", " ")}  [${v(f.kind)}]  from ${v(f.where)}${v(f.version) ? ` ${v(f.version)}` : ""}${v(f.email) ? `  · ${v(f.email)}` : ""}`);
  console.log(v(f.message), "\n");
}
console.error(`${items.length} message(s)`);
