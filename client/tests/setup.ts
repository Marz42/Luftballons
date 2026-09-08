import "fake-indexeddb/auto";
import {
  createMemorySecretStorage,
  setTokenStorage,
} from "../src/services/network-settings.js";

// Unit tests: private token storage is in-memory (not page localStorage).
setTokenStorage(createMemorySecretStorage());
