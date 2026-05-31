import { preMessage } from 'rc-util/es/warning';

const RC_UTIL_CIRCULAR_REFERENCE_FALSE_POSITIVE = 'Warning: There may be circular references';

export function installDependencyWarningDiagnostics() {
  preMessage((message) => {
    // rc-field-form may emit this false positive while comparing clean Form meta.
    if (message === RC_UTIL_CIRCULAR_REFERENCE_FALSE_POSITIVE) {
      return null;
    }
    return message;
  });
}
