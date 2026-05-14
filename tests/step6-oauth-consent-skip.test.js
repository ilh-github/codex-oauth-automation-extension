const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('content/signup-page.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') {
      parenDepth += 1;
    } else if (char === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (char === '{' && signatureEnded) {
      braceStart = index;
      break;
    }
  }
  if (braceStart < 0) {
    throw new Error(`missing body for function ${name}`);
  }

  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end += 1) {
    const char = source[end];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return source.slice(start, end);
}

test('password submit treats direct OAuth consent as a login-code skip', async () => {
  const api = new Function(`
const location = { href: 'https://auth.openai.com/authorize' };

function inspectLoginAuthState() {
  return {
    state: 'oauth_consent_page',
    url: location.href,
  };
}

function throwIfStopped() {}
async function sleep() {
  throw new Error('should not wait once oauth consent is detected');
}

${extractFunction('createStep6SuccessResult')}
${extractFunction('createStep6OAuthConsentSuccessResult')}
${extractFunction('createStep6RecoverableResult')}
${extractFunction('normalizeStep6Snapshot')}
${extractFunction('getStep6OptionMessage')}
${extractFunction('resolveStep6PostSubmitSnapshot')}
${extractFunction('waitForStep6PostSubmitTransition')}
${extractFunction('waitForStep6PasswordSubmitTransition')}

return {
  run() {
    return waitForStep6PasswordSubmitTransition(123, 1000);
  },
};
`)();

  const transition = await api.run();

  assert.equal(transition.action, 'done');
  assert.equal(transition.result.state, 'oauth_consent_page');
  assert.equal(transition.result.skipLoginVerificationStep, true);
  assert.equal(transition.result.directOAuthConsentPage, true);
  assert.equal(transition.result.loginVerificationRequestedAt, null);
});

test('step 7 entry succeeds when the auth page is already on OAuth consent', async () => {
  const logs = [];
  const api = new Function(`
const location = { href: 'https://auth.openai.com/authorize' };
const logs = arguments[0];

function inspectLoginAuthState() {
  return {
    state: 'oauth_consent_page',
    url: location.href,
    consentAccountIdentifier: 'user@example.com',
    consentAccountIdentifierType: 'email',
    consentAccountIdentifierNormalized: 'user@example.com',
    otherAccountTrigger: null,
  };
}

function throwIfStopped() {}
async function sleep() {}
function log(message, level = 'info') {
  logs.push({ message, level });
}

${extractFunction('createStep6SuccessResult')}
${extractFunction('createStep6OAuthConsentSuccessResult')}
${extractFunction('createStep6RecoverableResult')}
${extractFunction('normalizeActionText')}
${extractFunction('extractAccountIdentifierFromText')}
${extractFunction('getOAuthTargetAccount')}
${extractFunction('isPhoneAccountIdentifierMatch')}
${extractFunction('inspectStep6ExistingSessionMatch')}
${extractFunction('clickStep6ExistingSessionTrigger')}
${extractFunction('resolveStep6ExistingSessionChoice')}
${extractFunction('normalizeStep6Snapshot')}
${extractFunction('waitForKnownLoginAuthState')}
${extractFunction('step6_login')}

return {
  run() {
    return step6_login({ email: 'user@example.com' });
  },
};
`)(logs);

  const result = await api.run();

  assert.equal(result.step6Outcome, 'success');
  assert.equal(result.state, 'oauth_consent_page');
  assert.equal(result.skipLoginVerificationStep, true);
  assert.equal(result.directOAuthConsentPage, true);
  assert.equal(logs.some(({ level }) => level === 'ok'), true);
});

test('step 7 entry switches to other account when oauth consent session account mismatches target', async () => {
  const logs = [];
  const clicks = [];
  const api = new Function(`
const location = { href: 'https://auth.openai.com/authorize' };
const logs = arguments[0];
const clicks = arguments[1];
let stateIndex = 0;
const otherAccountTrigger = {
  click() {
    clicks.push('other-account');
  },
  focus() {},
  scrollIntoView() {},
  disabled: false,
  getAttribute(name) {
    if (name === 'aria-disabled') return 'false';
    return '';
  },
};

function inspectLoginAuthState() {
  stateIndex += 1;
  if (stateIndex <= 2) {
    return {
      state: 'oauth_consent_page',
      url: location.href,
      consentAccountIdentifier: 'other@example.com',
      consentAccountIdentifierType: 'email',
      consentAccountIdentifierNormalized: 'other@example.com',
      otherAccountTrigger,
    };
  }
  return {
    state: 'entry_page',
    url: 'https://auth.openai.com/log-in',
  };
}

function throwIfStopped() {}
async function sleep() {}
async function humanPause() {}
function log(message, level = 'info') {
  logs.push({ message, level });
}
function getOperationDelayRunner() {
  return async (_metadata, operation) => operation();
}
function simulateClick(el) {
  el.click();
}
async function step6OpenLoginEntry(payload, snapshot) {
  return { rerouted: true, payload, snapshot };
}
function getLoginAuthStateLabel(snapshot) {
  return snapshot?.state || 'unknown';
}

${extractFunction('createStep6SuccessResult')}
${extractFunction('createStep6OAuthConsentSuccessResult')}
${extractFunction('createStep6RecoverableResult')}
${extractFunction('normalizeActionText')}
${extractFunction('extractAccountIdentifierFromText')}
${extractFunction('getOAuthTargetAccount')}
${extractFunction('isPhoneAccountIdentifierMatch')}
${extractFunction('inspectStep6ExistingSessionMatch')}
${extractFunction('clickStep6ExistingSessionTrigger')}
${extractFunction('resolveStep6ExistingSessionChoice')}
${extractFunction('normalizeStep6Snapshot')}
${extractFunction('waitForKnownLoginAuthState')}
${extractFunction('step6_login')}

return {
  run() {
    return step6_login({ email: 'user@example.com' });
  },
};
`)(logs, clicks);

  const result = await api.run();

  assert.equal(result.rerouted, true);
  assert.deepStrictEqual(clicks, ['other-account']);
  assert.equal(logs.some(({ message }) => /不一致，正在切换到其他账号/.test(message)), true);
});

test('step 7 treats account chooser add-email landing as add-email handoff instead of retrying account choice', async () => {
  const logs = [];
  const clicks = [];
  const api = new Function(`
const location = { href: 'https://auth.openai.com/oauth/authorize' };
const logs = arguments[0];
const clicks = arguments[1];
let stateIndex = 0;
const matchingAccountTrigger = {
  click() {
    clicks.push('matching-account');
  },
  focus() {},
  scrollIntoView() {},
  disabled: false,
  getAttribute(name) {
    if (name === 'aria-disabled') return 'false';
    return '';
  },
};

function inspectLoginAuthState() {
  stateIndex += 1;
  if (stateIndex <= 2) {
    return {
      state: 'account_chooser_page',
      url: location.href,
      matchingAccountTrigger,
      otherAccountTrigger: null,
    };
  }
  return {
    state: 'add_email_page',
    url: 'https://auth.openai.com/add-email',
    addEmailPage: true,
  };
}

function throwIfStopped() {}
async function sleep() {}
async function humanPause() {}
function log(message, level = 'info') {
  logs.push({ message, level });
}
function getOperationDelayRunner() {
  return async (_metadata, operation) => operation();
}
function simulateClick(el) {
  el.click();
}
function findOAuthMatchingAccountTrigger() {
  return { element: matchingAccountTrigger };
}
function findOAuthOtherAccountTrigger() {
  return null;
}
function getLoginAuthStateLabel(snapshot) {
  return snapshot?.state || 'unknown';
}

${extractFunction('createStep6SuccessResult')}
${extractFunction('createStep6AddEmailSuccessResult')}
${extractFunction('createStep6OAuthConsentSuccessResult')}
${extractFunction('createStep6RecoverableResult')}
${extractFunction('normalizeActionText')}
${extractFunction('extractAccountIdentifierFromText')}
${extractFunction('getOAuthTargetAccount')}
${extractFunction('isPhoneAccountIdentifierMatch')}
${extractFunction('inspectStep6ExistingSessionMatch')}
${extractFunction('clickStep6ExistingSessionTrigger')}
${extractFunction('resolveStep6ExistingSessionChoice')}
${extractFunction('normalizeStep6Snapshot')}
${extractFunction('waitForKnownLoginAuthState')}
${extractFunction('step6_login')}

return {
  run() {
    return step6_login({ phoneNumber: '+5566984760629', loginIdentifierType: 'phone' });
  },
};
`)(logs, clicks);

  const result = await api.run();

  assert.equal(result.step6Outcome, 'success');
  assert.equal(result.state, 'add_email_page');
  assert.equal(result.addEmailPage, true);
  assert.equal(result.via, 'account_chooser_selected_add_email_page');
  assert.deepStrictEqual(clicks, ['matching-account']);
  assert.equal(logs.some(({ message, level }) => level === 'ok' && /添加邮箱页/.test(message)), true);
});
