/** Letters and digits that cannot be misread when a password is read aloud or copied by hand (no 0/O, 1/l/I). */
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%*-_+=?";
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

/** Uniform random index below `max`, from the platform's secure random source. */
function randomIndex(max: number): number {
  // Reject values above the largest multiple of max, so every index is equally likely.
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % max;
}

/**
 * A random password of `length` characters with at least one lower-case letter,
 * upper-case letter, digit and symbol. 16 characters meets the 12-character rule with room to spare.
 */
export function generatePassword(length = 16): string {
  if (length < 12) throw new Error("A generated password must be at least 12 characters.");
  const chars = [LOWER, UPPER, DIGITS, SYMBOLS].map((set) => set[randomIndex(set.length)]);
  while (chars.length < length) chars.push(ALL[randomIndex(ALL.length)]);
  // Shuffle so the four required characters are not always first.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
