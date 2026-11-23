import { Api } from "teleproto";
import { rpcError } from "./resolver.js";

/**
 * افزودن یک یا چند کاربر به گروه مقصد.
 * - سوپرگروه/کانال: channels.InviteToChannel (پشتیبانی از چند یوزر در یک درخواست)
 * - گروه ساده: messages.AddChatUser (فقط یک یوزر در هر درخواست)
 */
export async function inviteUsers(client, target, inputUsers) {
  if (!inputUsers.length) return null;

  if (target.type === "channel") {
    return client.invoke(
      new Api.channels.InviteToChannel({
        channel: target.inputChannel,
        users: inputUsers,
      }),
    );
  }

  if (target.type === "chat") {
    if (inputUsers.length > 1) {
      throw rpcError("CHAT_MEMBER_ADD_FAILED", "در گروه ساده فقط یک یوزر در هر درخواست قابل ادد است");
    }
    return client.invoke(
      new Api.messages.AddChatUser({
        chatId: target.chatId,
        userId: inputUsers[0],
        fwdLimit: 0,
      }),
    );
  }

  throw rpcError("CHAT_ID_INVALID", "نوع مقصد پشتیبانی نمی‌شود");
}
