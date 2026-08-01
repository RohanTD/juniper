"""Per-call session registry.

Conversation state is keyed by call id — never by the messages array Deepgram
sends.  Deepgram's view of history is a degraded copy; the controller's
TranscriptBuffer is canonical (docs/DEEPGRAM_INTEGRATION.md).
"""

from __future__ import annotations

from typing import Awaitable, Callable

from .controller import ConversationController

ControllerFactory = Callable[[str], Awaitable[ConversationController]]


class CallRegistry:
    def __init__(self, factory: ControllerFactory | None = None):
        self._factory = factory
        self._controllers: dict[str, ConversationController] = {}

    def register(self, call_id: str, controller: ConversationController) -> None:
        self._controllers[call_id] = controller

    def get(self, call_id: str) -> ConversationController | None:
        return self._controllers.get(call_id)

    async def ensure(self, call_id: str) -> ConversationController:
        controller = self._controllers.get(call_id)
        if controller is None:
            if self._factory is None:
                raise KeyError(call_id)
            controller = await self._factory(call_id)
            self._controllers[call_id] = controller
        return controller

    def pop(self, call_id: str) -> ConversationController | None:
        return self._controllers.pop(call_id, None)

    def items(self) -> tuple[tuple[str, ConversationController], ...]:
        return tuple(self._controllers.items())
