/**
 * Shared helpers for Phase 3 channel.basic module tests.
 */

import { createDomService } from "../../src/services/dom-service.js";
import { createNavigationService } from "../../src/sites/youtube-studio/navigation.js";
import { createChannelBasicModule } from "../../src/sites/youtube-studio/modules/channel-basic/module.js";
import type { LuftballonsModule } from "../../src/runtime/types.js";
import type { StudioFixtureHandle } from "../fixtures/studio-simulated.js";

export function createFixtureChannelModule(
  fixture: StudioFixtureHandle,
  overrides: {
    collectionId?: string;
    installationId?: string;
  } = {},
): LuftballonsModule {
  const dom = createDomService();
  const navigation = createNavigationService({
    dom,
    getHref: () => fixture.href,
    setHref: (href) => {
      const page = href.includes("/analytics")
        ? "ANALYTICS"
        : href.includes("/videos")
          ? "CONTENT"
          : href.includes("/translations")
            ? "SUBTITLES"
            : href.includes("/edit")
              ? "VIDEO_DETAILS"
              : "DASHBOARD";
      fixture.setPage(page);
    },
    defaultTimeoutMs: 500,
  });
  return createChannelBasicModule({
    dom,
    navigation,
    getHref: () => fixture.href,
    detectDocument: document,
    ...overrides,
  });
}
