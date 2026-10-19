// Generates firebase/database.rules.json.
// Realtime Database rules have no functions, so the shared predicates are
// composed here and inlined. Edit this file, then run `pnpm rules:build`.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const P = "'clayver/projects/' + $p";
const agentNode = (uid) => `root.child(${P} + '/agents/' + ${uid})`;

// The caller is an active agent (or admin) of workspace $p.
const isAgent = `(auth != null && ${agentNode("auth.uid")}.child('active').val() === true)`;
const isAdmin = `(${isAgent} && ${agentNode("auth.uid")}.child('role').val() === 'admin')`;
// The caller is customer `x`: the customer id is the Firebase Auth uid.
const isCustomer = (x) => `(auth != null && auth.uid === ${x})`;
// The customer `x` has an active moderation block (see moderation/ in the schema).
const modNode = (x) => `root.child(${P} + '/moderation/' + ${x})`;
const isBlocked = (x) =>
  `(${modNode(x)}.child('blocked').val() === true && (${modNode(x)}.child('until').val() == null || ${modNode(x)}.child('until').val() > now))`;
const HEX_COLOR = "/^#[0-9a-fA-F]{6}$/";
const convCustomer = `root.child(${P} + '/conversations/' + $c + '/customerId').val()`;

const str = (min, max) =>
  `newData.isString() && newData.val().length >= ${min} && newData.val().length <= ${max}`;
const optStr = (max) => ({ ".validate": str(0, max) });
const deny = { ".validate": false };
// Photos only, compressed by the SDKs before upload.
const MAX_ATTACHMENT = 300 * 1024;
const CONTENT_TYPES = "/^image\\/(jpeg|png|gif|webp|heic)$/";

// Read markers only move forward and never into the future.
const readAt = "newData.isNumber() && newData.val() <= now && (!data.exists() || newData.val() >= data.val())";

// A triage value must be in the workspace's list, or one of the defaults while no list is saved.
const triageValue = (kind, defaults) => {
  const list = `root.child(${P} + '/triageOptions/${kind}')`;
  return `newData.isString() && (${list}.child(newData.val()).exists() || (!${list}.exists() && (${defaults
    .map((d) => `newData.val() === '${d}'`)
    .join(" || ")})))`;
};

const deviceRegistration = (platforms) => ({
  ".validate": `$deviceId.matches(/^[A-Za-z0-9_-]{8,64}$/) && newData.hasChildren(['uid', 'platform', 'pushToken', 'active', 'updatedAt'])`,
  uid: { ".validate": "newData.val() === auth.uid" },
  platform: { ".validate": platforms.map((p) => `newData.val() === '${p}'`).join(" || ") },
  pushToken: { ".validate": str(1, 4096) },
  active: { ".validate": "newData.isBoolean()" },
  updatedAt: { ".validate": "newData.val() === now" },
  appVersion: optStr(64),
  sdkVersion: optStr(64),
  locale: optStr(64),
  $other: deny,
});

const rules = {
  rules: {
    ".read": false,
    ".write": false,
    clayver: {
      projects: {
        $p: {
          ".validate": "$p.matches(/^[a-z0-9-]{1,40}$/)",

          conversations: {
            ".read": isAgent,
            ".indexOn": ["statusOrder", "updatedAt", "customerId", "assigneeUid"],
            $c: {
              ".read": `${isAgent} || ${isCustomer("data.child('customerId').val()")}`,
              // Customers create their own conversations; nobody but functions updates them wholesale.
              ".write": `!data.exists() && newData.exists() && ${isCustomer("newData.child('customerId').val()")} && !${isBlocked("newData.child('customerId').val()")}`,
              ".validate": "newData.hasChildren(['customerId', 'status', 'createdAt']) && (data.exists() || newData.child('status').val() === 'open')",
              customerId: { ".validate": "newData.isString() && (!data.exists() || data.val() === newData.val())" },
              status: {
                ".write": `${isAgent} && data.exists()`,
                ".validate": "newData.val() === 'open' || newData.val() === 'closed'",
              },
              assigneeUid: {
                ".write": `${isAgent} && data.parent().exists()`,
                // Only agents assign, and only to an active agent.
                ".validate": `${isAgent} && newData.isString() && root.child(${P} + '/agents/' + newData.val() + '/active').val() === true`,
              },
              createdAt: { ".validate": "newData.val() === now" },
              // Maintained by Cloud Functions only.
              updatedAt: deny,
              lastMessage: deny,
              unread: deny,
              statusOrder: deny,
              closedAt: deny,
              rev: deny,
              unreadBasis: deny,
              $other: deny,
            },
          },

          messages: {
            $c: {
              ".read": `${isAgent} || ${isCustomer(convCustomer)}`,
              ".indexOn": ["createdAt"],
              $m: {
                // Messages are immutable. senderType is never trusted on its own: it must match
                // the caller's identity (customer of this conversation, or an active agent).
                ".write": `!data.exists() && newData.exists() && ${convCustomer} != null && (` +
                  `(newData.child('senderType').val() === 'customer' && ${isCustomer(convCustomer)} && newData.child('senderId').val() === ${convCustomer} && !${isBlocked(convCustomer)})` +
                  ` || (newData.child('senderType').val() === 'agent' && ${isAgent} && newData.child('senderId').val() === auth.uid))`,
                ".validate": "newData.hasChildren(['senderId', 'senderType', 'createdAt']) && (newData.hasChild('text') || newData.hasChild('attachment'))",
                senderId: { ".validate": "newData.isString()" },
                senderType: { ".validate": "newData.val() === 'customer' || newData.val() === 'agent'" },
                senderName: { ".validate": `newData.parent().child('senderType').val() === 'agent' && ${str(1, 80)}` },
                text: { ".validate": str(1, 4000) },
                createdAt: { ".validate": "newData.val() === now" },
                clientMessageId: { ".validate": str(1, 64) },
                attachment: {
                  ".validate": "newData.hasChildren(['storagePath', 'fileName', 'contentType', 'size'])",
                  storagePath: {
                    ".validate": `newData.isString() && newData.val().length <= 600 && newData.val().beginsWith(${P} + '/customers/' + ${convCustomer} + '/conversations/' + $c + '/')`,
                  },
                  fileName: { ".validate": str(1, 200) },
                  contentType: { ".validate": `newData.isString() && newData.val().matches(${CONTENT_TYPES})` },
                  size: { ".validate": `newData.isNumber() && newData.val() > 0 && newData.val() <= ${MAX_ATTACHMENT}` },
                  width: { ".validate": "newData.isNumber() && newData.val() > 0" },
                  height: { ".validate": "newData.isNumber() && newData.val() > 0" },
                  $other: deny,
                },
                $other: deny,
              },
            },
          },

          reads: {
            $c: {
              ".read": `${isAgent} || ${isCustomer(convCustomer)}`,
              customer: {
                ".write": `${convCustomer} != null && ${isCustomer(convCustomer)}`,
                ".validate": "newData.hasChildren(['lastReadAt'])",
                lastReadAt: { ".validate": readAt },
                $other: deny,
              },
              agent: {
                ".write": `${convCustomer} != null && ${isAgent}`,
                ".validate": "newData.hasChildren(['lastReadAt', 'uid'])",
                lastReadAt: { ".validate": readAt },
                uid: { ".validate": "newData.val() === auth.uid" },
                $other: deny,
              },
              $other: deny,
            },
          },

          inbox: {
            $cid: { ".read": isCustomer("$cid") },
          },

          users: {
            $cid: {
              ".read": `${isAgent} || ${isCustomer("$cid")}`,
              properties: {
                ".write": isCustomer("$cid"),
                $key: {
                  // Custom keys can't start with "_": those are the SDKs' UserProperty keys, strings only.
                  ".validate": `($key.matches(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/) && ((newData.isString() && newData.val().length <= 1000) || newData.isNumber() || newData.isBoolean())) || (($key === '_name' || $key === '_email' || $key === '_uid') && newData.isString() && newData.val().length <= 1000)`,
                },
              },
              lastSeenAt: { ".write": isCustomer("$cid"), ".validate": "newData.val() === now" },
              notifications: {
                ".write": isCustomer("$cid"),
                enabled: { ".validate": "newData.isBoolean()" },
                $other: deny,
              },
              // Written by functions only (the customer's Firebase Auth account).
              account: deny,
              createdAt: deny,
              $other: deny,
            },
          },

          agents: {
            ".read": isAgent,
            $uid: {
              ".read": "auth != null && auth.uid === $uid",
              // Functions write the record; an active agent may rename themselves.
              displayName: {
                ".write": `auth != null && auth.uid === $uid && ${isAgent}`,
                ".validate": str(1, 80),
              },
            },
          },

          agentSettings: {
            $uid: {
              ".read": "auth != null && auth.uid === $uid",
              ".write": `auth != null && auth.uid === $uid && ${isAgent}`,
              notifications: {
                push: { ".validate": "newData.isBoolean()" },
                $other: deny,
              },
              $other: deny,
            },
          },

          devices: {
            customers: {
              $cid: {
                ".read": isCustomer("$cid"),
                ".write": isCustomer("$cid"),
                $deviceId: deviceRegistration(["ios", "android"]),
              },
            },
            agents: {
              $uid: {
                ".read": "auth != null && auth.uid === $uid",
                ".write": `auth != null && auth.uid === $uid && (${isAgent} || !newData.exists())`,
                $deviceId: deviceRegistration(["web", "ios", "android"]),
              },
            },
          },

          moderation: {
            ".read": isAgent,
            $cid: {
              ".read": isCustomer("$cid"),
              ".write": isAgent,
              ".validate": "newData.hasChildren(['blocked', 'reason', 'by', 'at'])",
              blocked: { ".validate": "newData.val() === true" },
              // "rate_limit" blocks are written by functions only (as "system").
              reason: { ".validate": "newData.val() === 'spam' || newData.val() === 'abuse' || newData.val() === 'other'" },
              until: { ".validate": "newData.isNumber() && newData.val() > now" },
              by: { ".validate": "newData.val() === auth.uid" },
              at: { ".validate": "newData.val() === now" },
              $other: deny,
            },
          },

          tags: {
            ".read": isAgent,
            $tag: {
              // Agents create and edit; only admins delete (a function then untags every conversation).
              ".write": `${isAgent} && (newData.exists() || ${isAdmin})`,
              ".validate": "$tag.matches(/^[a-z0-9][a-z0-9-]{0,39}$/) && newData.hasChildren(['name', 'color', 'createdAt', 'createdBy'])",
              name: { ".validate": str(1, 40) },
              color: { ".validate": `newData.isString() && newData.val().matches(${HEX_COLOR})` },
              createdAt: { ".validate": "(!data.exists() && newData.val() === now) || newData.val() === data.val()" },
              createdBy: { ".validate": "(!data.exists() && newData.val() === auth.uid) || newData.val() === data.val()" },
              $other: deny,
            },
          },

          conversationTags: {
            ".read": isAgent,
            $c: {
              $tag: {
                ".write": `${isAgent} && (!newData.exists() || (root.child(${P} + '/tags/' + $tag).exists() && ${convCustomer} != null))`,
                ".validate": "newData.val() === true",
              },
            },
          },

          // Agent-only triage of a conversation (kept out of conversations/, which the customer reads).
          triage: {
            ".read": isAgent,
            $c: {
              ".write": `${isAgent} && (!newData.exists() || ${convCustomer} != null)`,
              priority: { ".validate": triageValue("priority", ["high", "medium", "low"]) },
              stage: { ".validate": triageValue("stage", ["todo", "in_progress", "on_hold"]) },
              $other: deny,
            },
          },

          // The priority and status lists. Any agent edits them; unset means the defaults.
          triageOptions: {
            ".read": isAgent,
            $kind: {
              ".write": isAgent,
              ".validate": "$kind === 'priority' || $kind === 'stage'",
              $option: {
                ".validate": "$option.matches(/^[a-z0-9][a-z0-9_-]{0,39}$/) && newData.hasChildren(['name', 'color', 'order'])",
                name: { ".validate": str(1, 40) },
                color: { ".validate": `newData.isString() && newData.val().matches(${HEX_COLOR})` },
                order: { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() < 100" },
                $other: deny,
              },
            },
          },

          tagIndex: {
            ".read": isAgent,
            $tag: { ".indexOn": [".value"] },
          },

          notes: {
            ".read": isAgent,
            $c: {
              $n: {
                // Internal notes are immutable; the author or an admin can delete one.
                ".write": `${isAgent} && ((!data.exists() && newData.exists() && ${convCustomer} != null) || (data.exists() && !newData.exists() && (data.child('authorUid').val() === auth.uid || ${isAdmin})))`,
                ".validate": "newData.hasChildren(['authorUid', 'text', 'createdAt'])",
                authorUid: { ".validate": "newData.val() === auth.uid" },
                authorName: { ".validate": str(1, 80) },
                text: { ".validate": str(1, 4000) },
                createdAt: { ".validate": "newData.val() === now" },
                $other: deny,
              },
            },
          },

          savedReplies: {
            ".read": isAgent,
            $r: {
              ".write": `${isAgent} && (newData.exists() || data.child('createdBy').val() === auth.uid || ${isAdmin})`,
              ".validate": "newData.hasChildren(['title', 'text', 'createdBy', 'createdAt', 'updatedAt'])",
              title: { ".validate": str(1, 80) },
              text: { ".validate": str(1, 4000) },
              createdBy: { ".validate": "(!data.exists() && newData.val() === auth.uid) || newData.val() === data.val()" },
              createdAt: { ".validate": "(!data.exists() && newData.val() === now) || newData.val() === data.val()" },
              updatedAt: { ".validate": "newData.val() === now" },
              $other: deny,
            },
          },

          config: {
            public: {
              ".read": "auth != null",
              ".write": isAdmin,
              teamName: { ".validate": str(1, 80) },
              welcomeMessage: { ".validate": str(1, 1000) },
              accentColor: { ".validate": "newData.isString() && newData.val().matches(/^#[0-9a-fA-F]{6}$/)" },
              $other: deny,
            },
            private: {
              ".read": isAgent,
              ".write": isAdmin,
              notifyAgents: { ".validate": "newData.val() === 'all' || newData.val() === 'assignee_or_all'" },
              rateLimits: {
                messagesPerMinute: { ".validate": "newData.isNumber() && newData.val() >= 1 && newData.val() <= 1000" },
                conversationsPerHour: { ".validate": "newData.isNumber() && newData.val() >= 1 && newData.val() <= 1000" },
                $other: deny,
              },
              $other: deny,
            },
            $other: deny,
          },

          // tokenIndex, notificationLog, limits and meta are server-only: no client rules grant access.
        },
      },
    },
  },
};

const out = fileURLToPath(new URL("../database.rules.json", import.meta.url));
writeFileSync(out, JSON.stringify(rules, null, 2) + "\n");
console.log(`wrote ${out}`);
