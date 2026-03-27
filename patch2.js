const fs = require('fs');

const file = 'packages/core/src/plugins/oauth/plugin.ts';
let code = fs.readFileSync(file, 'utf-8');

const searchRegex = /  const \[stateResult, codeVerifierResult, redirectUriHash\] = await Promise\.all\(\[\n    \(async \(\) => \{\n      const state = await services\.crypto\.generateOpaqueToken\(\);\n      if \(isAuthError\(state\)\) return state;\n      const stateHash = await services\.crypto\.deriveTokenId\(state\);\n      if \(isAuthError\(stateHash\)\) return stateHash;\n      return \{ state, stateHash \};\n    \}\)\(\),\n    \(async \(\) => \{\n      const codeVerifier = await services\.crypto\.generateOpaqueToken\(\);\n      if \(isAuthError\(codeVerifier\)\) return codeVerifier;\n      const codeChallenge = await services\.crypto\.deriveTokenVerifier\(codeVerifier\);\n      if \(isAuthError\(codeChallenge\)\) return codeChallenge;\n      return \{ codeVerifier, codeChallenge \};\n    \}\)\(\),\n    services\.crypto\.deriveTokenId\(redirectTo \?\? '\/'\)\n  \]\);\n\n  if \(isAuthError\(stateResult\)\) \{\n    return stateResult;\n  \}\n  if \(isAuthError\(codeVerifierResult\)\) \{\n    return codeVerifierResult;\n  \}\n  if \(isAuthError\(redirectUriHash\)\) \{\n    return redirectUriHash;\n  \}\n\n  const \{ state, stateHash \} = stateResult;\n  const \{ codeVerifier, codeChallenge \} = codeVerifierResult;/;

const replaceString = `  const state = await services.crypto.generateOpaqueToken();
  if (isAuthError(state)) {
    return state;
  }

  const codeVerifier = await services.crypto.generateOpaqueToken();
  if (isAuthError(codeVerifier)) {
    return codeVerifier;
  }

  const [codeChallenge, stateHash, redirectUriHash] = await Promise.all([
    services.crypto.deriveTokenVerifier(codeVerifier),
    services.crypto.deriveTokenId(state),
    services.crypto.deriveTokenId(redirectTo ?? '/')
  ]);

  if (isAuthError(codeChallenge)) {
    return codeChallenge;
  }
  if (isAuthError(stateHash)) {
    return stateHash;
  }
  if (isAuthError(redirectUriHash)) {
    return redirectUriHash;
  }`;

if (!searchRegex.test(code)) {
    console.error("Match not found");
    process.exit(1);
}

const newCode = code.replace(searchRegex, replaceString);
fs.writeFileSync(file, newCode, 'utf-8');
console.log("File patched successfully!");
