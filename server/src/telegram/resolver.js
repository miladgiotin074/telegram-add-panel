import { Api } from "teleproto";
import { parseTarget } from "../utils/target.js";

/** ساخت خطای هم‌شکل با خطاهای تلگرام تا classifyError بتواند آن را تشخیص دهد */
export function rpcError(code, message) {
  const err = new Error(message || code);
  err.errorMessage = code;
  return err;
}

/**
 * تبدیل یوزرنیم به InputUser
 * @returns {Promise<{inputUser: any, user: any}>}
 */
export async function resolveUsername(client, username) {
  const res = await client.api.contacts.resolveUsername({ username });
  const users = res?.users || [];
  const peer = res?.peer;

  let user = null;
  if (peer?.userId != null) {
    user = users.find((u) => u?.id?.toString() === peer.userId.toString());
  }
  if (!user) {
    user = users.find((u) => u?.className === "User") || users[0];
  }
  if (!user || !user.className || user.className !== "User") {
    throw rpcError("USERNAME_NOT_OCCUPIED", `یوزرنیم @${username} یک کاربر تلگرام نیست`);
  }
  if (user.accessHash == null) {
    throw rpcError("USER_ID_INVALID", `accessHash برای @${username} در دسترس نیست`);
  }
  return {
    inputUser: new Api.InputUser({ userId: user.id, accessHash: user.accessHash }),
    user,
  };
}

function buildTarget(entity) {
  if (!entity) throw rpcError("CHAT_ID_INVALID", "مقصد پیدا نشد");

  if (entity.className === "ChannelForbidden") {
    throw rpcError("CHANNEL_PRIVATE", "دسترسی به این گروه/کانال وجود ندارد");
  }
  if (entity.className === "Channel") {
    return {
      type: "channel",
      id: entity.id.toString(),
      title: entity.title || "",
      isBroadcast: Boolean(entity.broadcast),
      isMegagroup: Boolean(entity.megagroup),
      inputChannel: new Api.InputChannel({
        channelId: entity.id,
        accessHash: entity.accessHash,
      }),
    };
  }
  if (entity.className === "ChatForbidden") {
    throw rpcError("CHANNEL_PRIVATE", "دسترسی به این گروه وجود ندارد");
  }
  if (entity.className === "Chat") {
    return {
      type: "chat",
      id: entity.id.toString(),
      title: entity.title || "",
      chatId: entity.id,
    };
  }
  throw rpcError("CHAT_ID_INVALID", "مقصد باید یک گروه یا سوپرگروه باشد");
}

/**
 * تشخیص و آماده‌سازی گروه مقصد (پشتیبانی از یوزرنیم و لینک دعوت)
 */
export async function resolveTarget(client, targetString, autoJoin = true) {
  const parsed = parseTarget(targetString);
  if (!parsed) throw rpcError("CHAT_ID_INVALID", "آدرس گروه مقصد نامعتبر است");

  if (parsed.kind === "invite") {
    const invite = await client.invoke(new Api.messages.CheckChatInvite({ hash: parsed.value }));

    if (invite?.className === "ChatInviteAlready" || invite?.chat) {
      return buildTarget(invite.chat);
    }
    if (invite?.className === "ChatInvitePeek") {
      return buildTarget(invite.chat);
    }

    if (!autoJoin) {
      throw rpcError("CHANNEL_PRIVATE", "اکانت عضو این لینک دعوت نیست و autoJoin خاموش است");
    }

    const updates = await client.invoke(new Api.messages.ImportChatInvite({ hash: parsed.value }));
    const chat = updates?.chats?.[0];
    if (!chat) throw rpcError("CHANNEL_PRIVATE", "گروه مقصد از لینک دعوت استخراج نشد");
    return buildTarget(chat);
  }

  const entity = await client.getEntity(parsed.value);
  return buildTarget(entity);
}

function isGroupEntity(entity) {
  if (!entity) return false;
  if (entity.className === "Chat") return true;
  if (entity.className === "Channel") return Boolean(entity.megagroup);
  return false;
}

/**
 * عضویت یک اکانت در گروه مقصد (فقط سوپرگروه/کانال امکان جوین خودکار دارد).
 * اگر اکانت از قبل عضو باشد، موفق در نظر گرفته می‌شود.
 */
export async function joinTarget(client, target) {
  if (!target || target.type !== "channel") return { joined: false, reason: "not-joinable" };
  try {
    await client.invoke(new Api.channels.JoinChannel({ channel: target.inputChannel }));
    return { joined: true };
  } catch (err) {
    const code = String(err?.errorMessage || err?.message || "");
    if (code.includes("USER_ALREADY_PARTICIPANT")) return { joined: true, already: true };
    throw err;
  }
}

/** خروج اکانت از گروه مقصد (اگر از قبل عضو نباشد، موفق در نظر گرفته می‌شود) */
export async function leaveTarget(client, target) {
  if (!target || target.type !== "channel") return false;
  try {
    await client.invoke(new Api.channels.LeaveChannel({ channel: target.inputChannel }));
    return true;
  } catch (err) {
    const code = String(err?.errorMessage || err?.message || "");
    if (code.includes("USER_NOT_PARTICIPANT")) return true;
    throw err;
  }
}

/**
 * گرفتن انتیتی خام یک گروه از روی لینک/یوزرنیم (برای اسکن سابقه چت).
 * در صورت لینک دعوت، در صورت نیاز خودکار عضو می‌شود.
 * @returns {Promise<{entity:any, title:string, id:string|null}>}
 */
export async function resolveEntity(client, targetString, autoJoin = true) {
  const parsed = parseTarget(targetString);
  if (!parsed) throw rpcError("CHAT_ID_INVALID", "آدرس گروه نامعتبر است");

  let entity;
  if (parsed.kind === "invite") {
    const invite = await client.invoke(new Api.messages.CheckChatInvite({ hash: parsed.value }));
    if (invite?.className === "ChatInviteAlready" || invite?.className === "ChatInvitePeek") {
      entity = invite.chat;
    } else {
      if (!autoJoin) throw rpcError("CHANNEL_PRIVATE", "اکانت عضو این لینک دعوت نیست و autoJoin خاموش است");
      const updates = await client.invoke(new Api.messages.ImportChatInvite({ hash: parsed.value }));
      entity = updates?.chats?.[0];
      if (!entity) throw rpcError("CHANNEL_PRIVATE", "گروه از لینک دعوت استخراج نشد");
    }
  } else {
    entity = await client.getEntity(parsed.value);
  }

  if (!entity) throw rpcError("CHAT_ID_INVALID", "گروه پیدا نشد");
  if (entity.className === "ChannelForbidden" || entity.className === "ChatForbidden") {
    throw rpcError("CHANNEL_PRIVATE", "دسترسی به این گروه وجود ندارد");
  }
  if (!isGroupEntity(entity)) {
    throw rpcError("CHAT_ID_INVALID", "این مقصد یک گروه نیست");
  }

  // اگر اکانت عضو سوپرگروه/کانال عمومی نیست، تلاش کن عضو شود
  if (entity.className === "Channel" && entity.left) {
    try {
      const input = await client.getInputEntity(entity);
      await client.invoke(new Api.channels.JoinChannel({ channel: input }));
    } catch {
      /* اگر عضو نشد، هنگام خواندن پیام‌ها خطا برمی‌گردد */
    }
  }

  return { entity, title: entity.title || "", id: entity.id != null ? entity.id.toString() : null };
}
