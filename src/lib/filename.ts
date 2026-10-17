/**
 * A title made safe to use as a file name on Windows, macOS and Linux: no characters Windows forbids, no control
 * characters, no invisible text-direction marks (which can make "…exe.mp4" display as "…4pm.exe"), no leading or
 * trailing dots, and never a reserved Windows device name (CON, NUL, COM1… even with an extension: "nul.txt").
 */
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i;

export function safeFileName(title: string, fallback: string, max = 120) {
  let s = title
    .replace(/[‎‏‪-‮⁦-⁩؜]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, max)
    .replace(/[. ]+$/, "");
  if (!s) return fallback;
  if (RESERVED.test(s.split(".")[0].trim())) s = `${fallback} ${s}`;
  return s;
}
