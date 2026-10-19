import { onValueDeleted, onValueWritten } from "firebase-functions/v2/database";
import { db } from "./admin";
import { REGION } from "./config";
import { paths } from "./paths";

/**
 * Points tagIndex/{tag}/{conversation} at the conversation's current statusOrder for
 * every tag it has, and drops entries for tags it no longer has.
 */
export async function syncTagIndex(projectId: string, conversationId: string): Promise<void> {
  const [convSnap, tagsSnap] = await Promise.all([
    db().ref(`${paths.conversation(projectId, conversationId)}/statusOrder`).get(),
    db().ref(paths.conversationTags(projectId, conversationId)).get(),
  ]);
  const order = convSnap.val() as string | null;
  const tags = Object.keys((tagsSnap.val() ?? {}) as Record<string, true>);
  if (tags.length === 0) return;
  const updates: Record<string, string | null> = {};
  for (const tag of tags) updates[`${tag}/${conversationId}`] = order;
  await db().ref(paths.tagIndexRoot(projectId)).update(updates);
}

/** A conversation gained or lost a tag. */
export const clayverOnConversationTagWritten = onValueWritten(
  { ref: "/clayver/projects/{projectId}/conversationTags/{conversationId}/{tagId}", region: REGION },
  async (event) => {
    const { projectId, conversationId, tagId } = event.params;
    const entry = db().ref(`${paths.tagIndex(projectId, tagId)}/${conversationId}`);
    if (!event.data.after.exists()) {
      await entry.remove();
      return;
    }
    const order = (await db().ref(`${paths.conversation(projectId, conversationId)}/statusOrder`).get()).val();
    // Re-check the tag is still there, so a late event can't resurrect a removed entry.
    const still = (await db().ref(`${paths.conversationTags(projectId, conversationId)}/${tagId}`).get()).val();
    if (still === true && typeof order === "string") await entry.set(order);
    else await entry.remove();
  },
);

/** An admin deleted a tag: untag every conversation that had it. */
export const clayverOnTagDeleted = onValueDeleted(
  { ref: "/clayver/projects/{projectId}/tags/{tagId}", region: REGION },
  async (event) => {
    const { projectId, tagId } = event.params;
    const indexed = Object.keys(((await db().ref(paths.tagIndex(projectId, tagId)).get()).val() ?? {}) as object);
    const updates: Record<string, null> = { [`tagIndex/${tagId}`]: null };
    for (const c of indexed) updates[`conversationTags/${c}/${tagId}`] = null;
    await db().ref(paths.project(projectId)).update(updates);
  },
);
