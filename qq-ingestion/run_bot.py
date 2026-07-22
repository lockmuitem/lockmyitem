import asyncio
import os
from pathlib import Path

import botpy
from botpy.message import GroupMessage

from lockmyitem_qqbot.aggregator import IncomingMessage
from lockmyitem_qqbot.client import LockMyItemIngestClient, attachment_urls
from check_config import load_env_file


class LockMyItemQQBot(botpy.Client):
    async def on_ready(self):
        self.ingest = LockMyItemIngestClient(self.reply_to_group)
        stats = await asyncio.to_thread(self.ingest.spool.stats)
        print(f"LockMyItem local queue: {stats['pending']} pending, {stats['processed']} processed")
        if self.ingest.backend_configured and (not getattr(self, "outbox_task", None) or self.outbox_task.done()):
            self.outbox_task = asyncio.create_task(self.deliver_outbox())
        mode = "backend delivery" if self.ingest.backend_configured else "local queue only"
        print(f"LockMyItem QQ bot is ready ({mode})")

    async def _accept_group_message(self, message: GroupMessage):
        author = getattr(message, "author", None)
        sender_id = getattr(author, "member_openid", "") or getattr(author, "id", "") or "unknown"
        await self.ingest.accept(IncomingMessage(
            message_id=str(message.id),
            group_id=str(message.group_openid),
            group_name=os.getenv("QQ_GROUP_NAME", "上科大健忘者互助协会"),
            sender_id=str(sender_id),
            text=str(getattr(message, "content", "") or "").strip(),
            image_urls=attachment_urls(message),
            sent_at=str(getattr(message, "timestamp", "") or ""),
        ))

    async def on_group_at_message_create(self, message: GroupMessage):
        await self._accept_group_message(message)

    async def reply_to_group(self, message: IncomingMessage, content: str):
        await self.api.post_group_message(
            group_openid=message.group_id,
            msg_type=0,
            msg_id=message.message_id,
            content=content,
        )

    async def deliver_outbox(self):
        while True:
            try:
                await self.ingest.deliver_pending()
                messages = await asyncio.to_thread(self.ingest.pull_outbox)
                for entry in messages:
                    try:
                        arguments = dict(
                            group_openid=entry["groupId"],
                            msg_type=0,
                            content=entry["content"],
                        )
                        if entry.get("messageId"):
                            arguments["msg_id"] = entry["messageId"]
                        await self.api.post_group_message(**arguments)
                        await asyncio.to_thread(self.ingest.ack_outbox, entry["id"], True, "")
                    except Exception as error:
                        await asyncio.to_thread(self.ingest.ack_outbox, entry["id"], False, str(error))
            except Exception as error:
                print(f"QQ outbox polling failed: {error}")
            await asyncio.sleep(10)


if __name__ == "__main__":
    env_file = Path(__file__).with_name(".env")
    if env_file.is_file():
        load_env_file(env_file)
    intents = botpy.Intents(public_messages=True)
    LockMyItemQQBot(intents=intents).run(appid=os.environ["QQ_BOT_APP_ID"], secret=os.environ["QQ_BOT_SECRET"])
