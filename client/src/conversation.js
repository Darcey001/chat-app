/** Name shown for a conversation: the group name, or the other person's username. */
export function conversationTitle(conversation, me) {
  if (conversation.isGroup) return conversation.name;
  return conversation.members.find((m) => m.id !== me.id)?.username ?? 'Just you';
}
