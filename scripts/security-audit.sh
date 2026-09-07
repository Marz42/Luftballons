#!/usr/bin/env bash
# Luftballons Phase 6 — repeatable security audit (IMPLEMENTATION §58 / FT-018).
#
# Exit 0 = clean. Exit 1 = any violation.
# Intended for local runs and CI. Does not modify the tree.
#
# ---------------------------------------------------------------------------
# Rules (violations → fail)
# ---------------------------------------------------------------------------
# 1) Userscript header (client/dist/Luftballons.user.js):
#    - @match only https://www.youtube.com/* and https://studio.youtube.com/*
#    - no @connect at all
#    - no wildcard @match (*://*/* or bare *)
#
# 2) Source (client/src/**/*.ts) forbidden patterns:
#    - eval(
#    - new Function(
#    - innerHTML =   (assignment only; comments mentioning innerHTML are OK)
#    - GM_xmlhttpRequest
#    - document.cookie
#    - localStorage token storage outside whitelist (see below)
#
# 3) Dist artifact: same forbidden patterns as (2), minus TypeScript-only
#    localStorage key allowlisting (dist uses string literals; see below).
#
# ---------------------------------------------------------------------------
# Whitelist (NOT violations)
# ---------------------------------------------------------------------------
# - localStorage defaults / getItem / setItem in:
#     client/src/services/network-settings.ts
#     client/src/services/network-service.ts
#     client/src/services/config-service.ts
#     client/src/schemas/installation.ts
#   Keys must use the `luftballons.` prefix (enforced by grepping those files
#   for setItem/getItem string literals that are not luftballons.*).
# - Comments that mention forbidden APIs without calling them
#   (e.g. "no untrusted innerHTML").
# - MutationObserver in waitForDomTarget (bounded + disconnect) is audited
#   separately in SECURITY.md / release-gate — this script does not fail on it.
# - Test fixtures under client/tests/ are out of scope for this script.
#
# Severity note for humans reading CI output:
#   Any exit 1 here is P0 for release until fixed or explicitly waived in
#   SECURITY.md with rationale.
# ---------------------------------------------------------------------------

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/client/src"
DIST="$ROOT/client/dist/Luftballons.user.js"
REPORT=()
FAIL=0

note() { REPORT+=("$*"); }
fail() {
  FAIL=1
  REPORT+=("FAIL: $*")
}

section() {
  REPORT+=("")
  REPORT+=("## $*" )
}

# --- helpers ---------------------------------------------------------------

# Fixed-string grep; returns matches or empty. Never exits non-zero from rg alone.
rg_fixed() {
  local pattern="$1"
  shift
  rg -n --fixed-strings "$pattern" "$@" 2>/dev/null || true
}

rg_regex() {
  local pattern="$1"
  filter_out="${2:-}"
  shift 2 || true
  if [[ -n "$filter_out" ]]; then
    rg -n -P "$pattern" "$@" 2>/dev/null | grep -Ev "$filter_out" || true
  else
    rg -n -P "$pattern" "$@" 2>/dev/null || true
  fi
}

require_file() {
  if [[ ! -f "$1" ]]; then
    fail "missing required file: $1 (run pnpm build first for dist)"
    return 1
  fi
  return 0
}

# --- 1) Userscript header --------------------------------------------------

section "Userscript metadata (@match / @connect)"

if require_file "$DIST"; then
  header="$(sed -n '1,40p' "$DIST")"
  matches="$(printf '%s\n' "$header" | rg -n '^\s*//\s*@match\s+' || true)"
  connects="$(printf '%s\n' "$header" | rg -n '^\s*//\s*@connect\b' || true)"

  if [[ -z "$matches" ]]; then
    fail "dist header has no @match lines"
  else
    note "found @match lines:"
    while IFS= read -r line; do note "  $line"; done <<<"$matches"
  fi

  allowed_match_1='https://www.youtube.com/*'
  allowed_match_2='https://studio.youtube.com/*'
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    value="$(printf '%s\n' "$line" | sed -E 's/^[^:]+:[[:space:]]*\/\/[[:space:]]*@match[[:space:]]+//')"
    if [[ "$value" != "$allowed_match_1" && "$value" != "$allowed_match_2" ]]; then
      fail "disallowed @match: $value"
    fi
    if [[ "$value" == *"*"* && "$value" != "$allowed_match_1" && "$value" != "$allowed_match_2" ]]; then
      fail "wildcard @match: $value"
    fi
    if [[ "$value" == "*://*/*" || "$value" == "*" ]]; then
      fail "wildcard @match: $value"
    fi
  done <<<"$matches"

  # Ensure both required hosts are present.
  if ! printf '%s\n' "$matches" | grep -Fq "$allowed_match_1"; then
    fail "missing required @match $allowed_match_1"
  fi
  if ! printf '%s\n' "$matches" | grep -Fq "$allowed_match_2"; then
    fail "missing required @match $allowed_match_2"
  fi

  if [[ -n "$connects" ]]; then
    fail "@connect present (must be absent):"
    while IFS= read -r line; do note "  $line"; done <<<"$connects"
  else
    note "OK: no @connect"
  fi
fi

# --- 2) Source forbidden patterns ------------------------------------------

section "Source forbidden patterns (client/src)"

check_src_pattern() {
  local label="$1"
  local pattern="$2"
  local hits
  hits="$(rg_fixed "$pattern" "$SRC" -g '*.ts')"
  if [[ -n "$hits" ]]; then
    fail "$label found in source:"
    while IFS= read -r line; do note "  $line"; done <<<"$hits"
  else
    note "OK: no $label"
  fi
}

check_src_pattern "eval(" "eval("
check_src_pattern "new Function(" "new Function("
check_src_pattern "GM_xmlhttpRequest" "GM_xmlhttpRequest"
check_src_pattern "document.cookie" "document.cookie"

# innerHTML = assignment (not mere mentions)
inner_hits="$(rg_regex 'innerHTML\s*=' '' "$SRC" -g '*.ts')"
if [[ -n "$inner_hits" ]]; then
  fail "innerHTML assignment in source:"
  while IFS= read -r line; do note "  $line"; done <<<"$inner_hits"
else
  note "OK: no innerHTML assignment"
fi

# localStorage token: any setItem/getItem whose key literal is not luftballons.*
# Whitelist paths may use localStorage default args; key constants must be luftballons.*
section "localStorage key allowlist (luftballons.*)"

STORAGE_WHITELIST=(
  "$SRC/services/network-settings.ts"
  "$SRC/services/network-service.ts"
  "$SRC/services/config-service.ts"
  "$SRC/schemas/installation.ts"
)

# Fail if localStorage appears outside whitelist files (except comments/docs refs).
ls_hits="$(rg_fixed "localStorage" "$SRC" -g '*.ts')"
if [[ -n "$ls_hits" ]]; then
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    file="${line%%:*}"
    allowed=0
    for w in "${STORAGE_WHITELIST[@]}"; do
      if [[ "$file" == "$w" ]]; then
        allowed=1
        break
      fi
    done
    # Allow documentation comments in other files that mention localStorage.
    rest="${line#*:}"
    rest="${rest#*:}"
    if [[ "$allowed" -eq 0 ]]; then
      if printf '%s\n' "$rest" | grep -Eq '^[[:space:]]*(//|\*|/\*)'; then
        continue
      fi
      fail "localStorage outside whitelist path: $line"
    fi
  done <<<"$ls_hits"
fi

# Within whitelist files: string-literal storage keys must be luftballons.*
for w in "${STORAGE_WHITELIST[@]}"; do
  if [[ ! -f "$w" ]]; then
    fail "whitelist file missing: $w"
    continue
  fi
  # Capture quoted string literals in setItem/getItem/removeItem first arg.
  key_hits="$(rg -n -P "(getItem|setItem|removeItem)\(\s*[\"']([^\"']+)[\"']" "$w" 2>/dev/null || true)"
  if [[ -n "$key_hits" ]]; then
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      key="$(printf '%s\n' "$line" | sed -E "s/.*(getItem|setItem|removeItem)\([[:space:]]*[\"']([^\"']+)[\"'].*/\2/")"
      if [[ "$key" != luftballons.* ]]; then
        fail "non-luftballons storage key in $(basename "$w"): $key ($line)"
      fi
    done <<<"$key_hits"
  fi
done
note "OK: localStorage confined to whitelist + luftballons.* keys (or constant refs)"

# Constant-based keys: ensure STORAGE_KEYS / known consts use luftballons. prefix
const_keys="$(rg -n -P "[\"']luftballons\.[^\"']+[\"']" "${STORAGE_WHITELIST[@]}" 2>/dev/null || true)"
bad_keys="$(rg -n -P "(getItem|setItem|removeItem)\([\"'](?!luftballons\.)" "${STORAGE_WHITELIST[@]}" 2>/dev/null || true)"
if [[ -n "$bad_keys" ]]; then
  fail "storage API call with non-luftballons literal:"
  while IFS= read -r line; do note "  $line"; done <<<"$bad_keys"
fi
if [[ -z "$const_keys" ]]; then
  fail "expected luftballons.* key literals in storage whitelist files"
else
  note "OK: found luftballons.* key literals"
fi

# --- 3) Dist forbidden patterns --------------------------------------------

section "Dist forbidden patterns"

if require_file "$DIST"; then
  check_dist_pattern() {
    local label="$1"
    local pattern="$2"
    local hits
    hits="$(rg_fixed "$pattern" "$DIST")"
    if [[ -n "$hits" ]]; then
      fail "dist contains $label:"
      while IFS= read -r line; do note "  $line"; done <<<"$hits"
    else
      note "OK dist: no $label"
    fi
  }

  check_dist_pattern "eval(" "eval("
  check_dist_pattern "new Function(" "new Function("
  check_dist_pattern "GM_xmlhttpRequest" "GM_xmlhttpRequest"
  check_dist_pattern "document.cookie" "document.cookie"

  dist_inner="$(rg_regex 'innerHTML\s*=' '' "$DIST")"
  if [[ -n "$dist_inner" ]]; then
    fail "dist contains innerHTML assignment:"
    while IFS= read -r line; do note "  $line"; done <<<"$dist_inner"
  else
    note "OK dist: no innerHTML assignment"
  fi

  # Dist may contain localStorage for settings; keys must remain luftballons.*
  dist_bad_keys="$(rg -n -P "(getItem|setItem|removeItem)\([\"'](?!luftballons\.)[^\"']+[\"']" "$DIST" 2>/dev/null || true)"
  if [[ -n "$dist_bad_keys" ]]; then
    fail "dist storage key not luftballons.*:"
    while IFS= read -r line; do note "  $line"; done <<<"$dist_bad_keys"
  else
    note "OK dist: storage keys are luftballons.* (or none literal)"
  fi
fi

# --- summary ---------------------------------------------------------------

section "Summary"
printf '%s\n' "${REPORT[@]}"
echo ""
if [[ "$FAIL" -ne 0 ]]; then
  echo "security-audit: FAILED"
  exit 1
fi
echo "security-audit: PASSED"
exit 0
