/**
 * Contact Maintainer
 *
 * Builds contact URLs (Twitter DM, email) with pre-filled messages
 * referencing the tool and the user's specific pain context.
 */

import type { RepoMetadata } from "../scanner/github.js";

export interface ContactInfo {
  twitter?: string; // Full URL to compose a tweet/DM
  email?: string; // mailto: URL with pre-filled subject/body
  github: string; // Issues page URL (always available)
  message: string; // The pre-filled message text
}

export function buildContactInfo(
  toolName: string,
  repoUrl: string,
  maintainer: RepoMetadata["maintainer"],
  painContext?: string
): ContactInfo {
  const message = painContext
    ? `Hey! I found ${toolName} via AgentScout (github.com/implicit-labs/agentscout). ${painContext} — does ${toolName} handle this well? Any gotchas I should know about?`
    : `Hey! I found ${toolName} via AgentScout (github.com/implicit-labs/agentscout) and I'm considering adopting it. Any tips or gotchas for getting started?`;

  const encodedMessage = encodeURIComponent(message);
  const result: ContactInfo = {
    github: `${repoUrl}/issues`,
    message,
  };

  if (maintainer?.twitter) {
    const handle = maintainer.twitter.replace(/^@/, "");
    result.twitter = `https://x.com/${handle}`;
  }

  if (maintainer?.email) {
    result.email = `mailto:${maintainer.email}?subject=${encodeURIComponent(`Question about ${toolName}`)}&body=${encodedMessage}`;
  }

  return result;
}
