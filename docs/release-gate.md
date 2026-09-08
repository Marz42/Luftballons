# Release Gate — Luftballons v0.1

Checklist for `IMPLEMENTATION.md` §63–§65. Updated in Phase 6 (FT-018).

Legend: **PASS** = automated evidence green (**CI** `.github/workflows/ci.yml`: typecheck, client tests, server tests, build, `security-audit.sh`); **待真机** = needs live Studio / multi-PC; **NA** = not applicable for this milestone.

---

## Automated gate (CI)

| Check | Command / job | Required |
|-------|---------------|----------|
| Typecheck | `pnpm typecheck` | yes |
| Client tests | `pnpm test` | yes |
| Server tests | `cd server && pytest -q` | yes |
| Build | `pnpm build` | yes |
| Security audit | `./scripts/security-audit.sh` (after build) | yes |

PR / `main` commits must keep the CI workflow green before claiming automated PASS.

## Gate A — Functional (§63)

| Item | Status | Evidence |
|------|--------|----------|
| Basic Collector | PASS (unit) / 待真机 (live) | `channel-basic-collector.test.ts` P3-T1…; handbook `docs/manual-acceptance-p3.md` |
| CSV | PASS | `sinks.test.ts`; P3 handbook export |
| JSON | PASS | `sinks.test.ts` |
| Subtitle | PASS (unit) / 待真机 (live) | `subtitle-multilang.test.ts` P4-T1…T5; `docs/manual-acceptance-p4.md` |

---

## Gate B — Fail-safe

| Item | Status | Evidence |
|------|--------|----------|
| Unknown UI | PASS | `page-detector.test.ts`, `task-runner.test.ts` refuses UNKNOWN, `navigation.test.ts` refuses UNKNOWN layout |
| Cancel | PASS | `task-runner.test.ts` cancel; subtitle cancel paths |
| Partial Failure | PASS | `channel-basic-collector.test.ts` P3-T3; subtitle PARTIAL cases |

---

## Gate C — Offline

| Item | Status | Evidence |
|------|--------|----------|
| Server absent | PASS (unit) | Sync FAILED leaves local intact (`network.test.ts`); bootstrap without server |
| Network OFF | PASS (unit) / 待真机 (DevTools) | `security-network-mode.test.ts`, `config.test.ts` OFF zero-fetch; handbook § Network OFF |
| USB export workflow | PASS (local sinks) / 待真机 | CSV/JSON sinks; no network required |

---

## Gate D — Security

| Item | Status | Evidence |
|------|--------|----------|
| No remote code | PASS | `scripts/security-audit.sh`; no eval/new Function in src/dist |
| No arbitrary endpoint | PASS | Fixed `ENDPOINT_PATHS`; `assertHttpBaseUrl`; forbidden config keys |
| No credential collection | PASS | Audit forbids `document.cookie`; SPEC non-goals |
| Human Gate enforced | PASS | `human-gate.test.ts`; subtitle workflow gate before publish |

---

## Gate E — Multi-installation

| Item | Status | Evidence |
|------|--------|----------|
| ≥2 real PCs | 待真机 | Unit: installation isolation / idempotent ingest (`installation.test.ts`, `test_ingest.py`). Live: `docs/manual-acceptance-p5.md` |

---

## Blocker map (§64 → code / tests)

| Blocker | Guarantee | Evidence |
|---------|-----------|----------|
| 操作错视频 | Binding recheck before writes | `recheckVideoBinding` in `workflow.ts`; subtitle binding failure tests |
| 频道串写 | Channel binding recheck after nav | `recheckChannelBinding` in `collector.ts` |
| 误发布 | Human Gate + PUBLISHED postcondition | `human-gate.ts`; workflow publish confirmation / `PUBLISH_UNCONFIRMED` |
| 误删除 | No delete path in modules | Static review: no Studio delete automation |
| 未知 UI 继续点击 | Fail-closed | UNKNOWN layout → unavailable; navigation refuse |
| Server 宕机 → Client 不可用 | Offline local-first | Collect/subtitle without network; sync failure retain |
| Network OFF 仍外传 | Zero fetch | `security-network-mode.test.ts` OFF paths |
| Remote Config 控制 selector/action | Forbidden keys reject/drop | `security-compromise.test.ts`; server sanitize tests |
| Collection 丢失 | Local save before sync | IndexedDB collection service; retain-on-failed-sync test |
| 多 Installation 混淆 | `installation_id` isolation | Register + ingest auth bind token to installation |

---

## Major Bug list (§65)

Fixable then re-accept (must remain fail-closed, no wrong side effects):

- Page recognition failure for a specific Studio route
- Unsupported UI variant
- CSV formatting issues
- Admin display issues
- Partial field collection failures

---

## Related docs

- [`SECURITY.md`](../SECURITY.md)
- [`docs/manual-acceptance-p5.md`](./manual-acceptance-p5.md)
- [`IMPLEMENTATION.md`](../IMPLEMENTATION.md) §63–§66
