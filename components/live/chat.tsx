import MyAvatar from "@/components/live/avatar"
import { UsersContext } from "@/components/provider/users"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useToast } from "@/components/ui/use-toast"
import { setupChat } from "@livekit/components-core"
import { ChatMessage, ReceivedChatMessage, useRoomContext } from "@livekit/components-react"
import { User } from "@prisma/client"
import confetti from "canvas-confetti"
import { DataPacket_Kind, LocalParticipant, RemoteParticipant, RoomEvent } from "livekit-client"
import { Gift, SendHorizontal } from "lucide-react"
import { useRouter } from "next/navigation"
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { Observable } from "rxjs"


export type MessageEncoder = (message: ChatMessage) => Uint8Array
export type MessageDecoder = (message: Uint8Array) => ReceivedChatMessage

export function useObservableState<T>(observable: Observable<T> | undefined, startWith: T) {
  const [state, setState] = useState<T>(startWith)
  useEffect(() => {
    if (typeof window === "undefined" || !observable) return
    const subscription = observable.subscribe(setState)
    return () => subscription.unsubscribe()
  }, [observable])
  return state
}

export function useChat(options?: { messageEncoder?: MessageEncoder, messageDecoder?: MessageDecoder }) {
  const room = useRoomContext()
  const [setup, setSetup] = useState<ReturnType<typeof setupChat>>()
  const isSending = useObservableState(setup?.isSendingObservable as Observable<boolean> | undefined, false)
  const chatMessages = useObservableState(setup?.messageObservable as Observable<ReceivedChatMessage[]> | undefined, [])

  useEffect(() => {
    const setupChatReturn = setupChat(room, options)
    setSetup(setupChatReturn)
    return setupChatReturn.destroy
  }, [room, options])

  return { send: setup?.send, chatMessages, isSending }
}

export interface ChatProps extends React.HTMLAttributes<HTMLDivElement> {
  messageFormatter?: MessageFormatter
  messageEncoder?: MessageEncoder
  messageDecoder?: MessageDecoder
  room: string
  lp: LocalParticipant
  authenticated: boolean
}
export function Chat({ messageFormatter, messageDecoder, messageEncoder, room, lp, authenticated, ...props }: ChatProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const divRef = useRef<HTMLDivElement>(null)

  const { toast } = useToast()

  const { users } = useContext(UsersContext)

  const chatOptions = useMemo(() => {
    return { messageDecoder, messageEncoder }
  }, [messageDecoder, messageEncoder])

  const { send, chatMessages, isSending } = useChat(chatOptions)

  const join = async () => {
    if (send) await send(`加入了直播間`)
  }

  useEffect(() => {
    setTimeout(() => {
      join()
    }, 3000)
  }, [send])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (inputRef.current && inputRef.current.value.trim() !== "") {
      if (send) {
        await send(inputRef.current.value)
        inputRef.current.value = ""
        inputRef.current.focus()
      }
    }
  }

  useEffect(() => {
    divRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [chatMessages])

  // gift
  const sendGiftLock = useRef(false)
  const [gift, setGift] = useState("")
  const roomContext = useRoomContext()
  const textEncoder = useRef(new TextEncoder())
  const textDecoder = useRef(new TextDecoder())

  const router = useRouter()
  const update = async (point : string) => {
    await fetch(`/api/users?id=${lp.identity}&point=${point}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: lp.identity,
        point: point,
      }),
    })
    router.refresh()
  }

  const [point, setPoint] = useState(0)
  const [pointLock, setPointLock] = useState(false)

  if (lp.identity && !pointLock) {
    console.log("lp", lp.identity)
    console.log("point", users.find((user) => user.id === lp.identity)?.point)
    setPoint(users.find((user) => user.id === lp.identity)?.point as number)
    if (lp.identity) setPointLock(true)
  }

  const sendGiftHandle = useCallback(async (point: number, gift: string) => {
    console.log("prePoint", point)
    setPoint(point - 10)
    console.log("afterPoint", point)
    update((point - 10).toString())
    confetti()
    sendGift(gift)
  }, [gift]);

  const sendGift = useCallback(async (gift: string) => {
    try {
      const payload: Uint8Array = new TextEncoder().encode(
        JSON.stringify({ payload: gift, channelId: "gift" })
      )
      await lp.publishData(payload, DataPacket_Kind.LOSSY)
    } finally {

    }
  }, [lp, gift])

  const onDataChannel = useCallback(
    (payload: Uint8Array, participant: RemoteParticipant | undefined) => {
      if (!participant) return console.log("no participant");
      const data = JSON.parse(textDecoder.current.decode(payload));
      if (data.channelId === "gift") {
        confetti()
        toast({
          title: "收到來自 " + participant.name + " 的禮物！",
          description: new Date().toLocaleTimeString(),
        })
      }
    }, []
  )

  useEffect(() => {
    roomContext.on(RoomEvent.DataReceived, onDataChannel)
    return () => {
      roomContext.off(RoomEvent.DataReceived, onDataChannel)
    }
  }, [onDataChannel, roomContext])

  return (
    <div {...props} className="grid gap-4" >
      <ScrollArea className="h-[8.5rem] lg:h-[calc(100dvh-9rem-1px)] lg:border rounded-md pb-4">
        <ul>
          {chatMessages.map((msg, idx) =>
            <MyChatEntry key={idx} room={room} entry={msg} messageFormatter={messageFormatter} />
          )}
        </ul>
        <div ref={divRef} />
      </ScrollArea>
      <form className="flex gap-3" onSubmit={handleSubmit} >
        <Input className="rounded-md border border-border text-foreground" disabled={isSending} ref={inputRef} type="text" placeholder="..." />
        {lp.identity !== room && authenticated && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="rounded-md border border-border text-foreground" size="icon" variant="outline">
                <Gift className="h-4 w-4 text-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className=" rounded-lg bg-background mb-3 mr-4 p-2 flex gap-2">
              <DropdownMenuItem key={0} asChild>
                <AlertDialog>
                  <AlertDialogTrigger>
                    <Button className="rounded-sm border border-border text-foreground" size="icon" variant="outline">
                      🎉
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>贈送 🎉</AlertDialogTitle>
                      <AlertDialogDescription>
                        目前持有的點數：{point}
                        <br/>
                        將花費 10 點數贈送
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction onClick={() => sendGiftHandle(point, "gift")}>送出</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </DropdownMenuItem>
              <DropdownMenuItem key={1}>🎊</DropdownMenuItem>
              <DropdownMenuItem key={2}>🧨</DropdownMenuItem>
              <DropdownMenuItem key={3}>🎁</DropdownMenuItem>
              <DropdownMenuItem key={4}>🎈</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          // <Dialog>
          //   <DialogTrigger asChild>
          //     <Button className="rounded-md border border-border text-foreground" size="icon" variant="outline">
          //       <Gift className="h-4 w-4 text-foreground" />
          //     </Button>
          //   </DialogTrigger>
          //   <DialogContent>
          //     <DialogHeader>
          //       <DialogTitle>
          //         發送禮物
          //       </DialogTitle>
          //       <DialogDescription>
          //         目前持有的點數：{lp.identity}
          //       </DialogDescription>
          //     </DialogHeader>
          //     <DialogClose asChild>
          //       <Button onClick={() => sendGiftHandle("gift")} className="rounded-md border border-border text-foreground" size="icon" variant="outline">
          //         🎉
          //       </Button>
          //     </DialogClose>
          //   </DialogContent>
          // </Dialog>
        )}
        <Button className="rounded-md border border-border text-foreground" disabled={isSending} type="submit" size="icon" variant="outline" >
          <SendHorizontal className="h-4 w-4 text-foreground" />
        </Button>
      </form>
    </div>
  )
}

export type MessageFormatter = (message: string) => string
export interface ChatEntryProps extends React.HTMLAttributes<HTMLLIElement> {
  room: string
  entry: ReceivedChatMessage
  messageFormatter?: MessageFormatter
}
export function MyChatEntry({ room, entry, messageFormatter, ...props }: ChatEntryProps) {
  const formattedMessage = useMemo(() => {
    return messageFormatter ? messageFormatter(entry.message) : entry.message
  }, [entry.message, messageFormatter])
  const time = new Date(entry.timestamp)
  const locale = navigator ? navigator.language : "en-US"

  let { users } = useContext(UsersContext)

  const owner = users.find((user) => user.id === room)

  const router = useRouter()
  const update = async (owner: User | undefined, link: string | undefined) => {
    await fetch(`/api/link?id=${owner?.id}&link=${link}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: owner?.id,
        link: link,
      }),
    })
    router.refresh()
  }

  if (formattedMessage !== "abc") return (
    <li className="lk-chat-entry p-4 pb-0" title={time.toLocaleTimeString(locale, { timeStyle: "full" })} data-lk-message-origin={entry.from?.isLocal ? "local" : "remote"} {...props}>
      <div className="flex gap-2">
        <div className="mb-auto mt-0">
          <Popover>
            <PopoverTrigger>
              <MyAvatar identity={entry.from?.identity} />
            </PopoverTrigger>
            <PopoverContent>
              {owner?.link === entry.from?.identity ? (
                <Button onClick={() => update(owner, "")} variant="secondary" className="mr-4">
                  Disconnect
                </Button>
              ) : (
                <Button onClick={() => update(owner, users.find((user) => user.name === entry.from?.name)?.id)} variant="secondary" className="mr-4">
                  Connect
                </Button>
              )}
            </PopoverContent>
          </Popover>
        </div>
        <Label className="h-6 leading-6 text-muted-foreground" style={{ whiteSpace: "nowrap" }}>{entry.from?.name}</Label>
        <span className="box-border break-words w-fit p-0 leading-6 text-foreground bg-transparent" style={{ wordBreak: "break-word" }}>
          {formattedMessage}
        </span>
      </div>
    </li >
  )
}
