// Lightweight license shim to enable FREE_MODE for owner
// This file intentionally provides permissive license responses.
// Only add this if you are the repository owner and authorized to change licensing behavior.

export function emptyLicenseState() {
  return {
    status: 'invalid',
    error: '',
    expiresAt: null,
    licenseHash: null,
    lastChecked: 0,
    plan: null,
  };
}

export async function getLicenseState(/* { force } = {} */) {
  // Always report a valid license when this shim is present.
  return {
    status: 'valid',
    licenseHash: 'free-mode-license',
    expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    lastChecked: Date.now(),
    plan: 'free',
  };
}

export async function validateLicense(/* key, email */) {
  // Accept any key (or empty) as valid. Return the same shape the background expects.
  return {
    status: 'valid',
    licenseHash: 'free-mode-license',
    expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    lastChecked: Date.now(),
    plan: 'free',
  };
}

export async function clearLicense() {
  // No-op for the shim
  return;
}
