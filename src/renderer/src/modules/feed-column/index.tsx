/* eslint-disable @eslint-react/hooks-extra/no-direct-set-state-in-use-layout-effect */
import { getReadonlyRoute } from "@renderer/atoms/route"
import { useUISettingKey } from "@renderer/atoms/settings/ui"
import { useSidebarActiveView } from "@renderer/atoms/sidebar"
import { ActionButton } from "@renderer/components/ui/button"
import { HotKeyScopeMap, views } from "@renderer/constants"
import { shortcuts } from "@renderer/constants/shortcuts"
import { useNavigateEntry } from "@renderer/hooks/biz/useNavigateEntry"
import { useReduceMotion } from "@renderer/hooks/biz/useReduceMotion"
import { getRouteParams } from "@renderer/hooks/biz/useRouteParams"
import { useAuthQuery } from "@renderer/hooks/common"
import { stopPropagation } from "@renderer/lib/dom"
import { Routes } from "@renderer/lib/enum"
import { clamp, cn } from "@renderer/lib/utils"
import { Queries } from "@renderer/queries"
import { useSubscriptionStore } from "@renderer/store/subscription"
import { useFeedUnreadStore } from "@renderer/store/unread"
import { useSubscribeElectronEvent } from "@shared/event"
import { useWheel } from "@use-gesture/react"
import { AnimatePresence, m } from "framer-motion"
import { Lethargy } from "lethargy"
import type { FC, PropsWithChildren } from "react"
import { useCallback, useLayoutEffect, useRef, useState } from "react"
import { isHotkeyPressed, useHotkeys } from "react-hotkeys-hook"

import { WindowUnderBlur } from "../../components/ui/background"
import { FeedColumnHeader } from "./header"
import { FeedList } from "./list"

const lethargy = new Lethargy()

const useBackHome = (active: number) => {
  const navigate = useNavigateEntry()

  return useCallback(
    (overvideActive?: number) => {
      navigate({
        feedId: null,
        entryId: null,
        view: overvideActive ?? active,
      })
    },
    [active, navigate],
  )
}

const useUnreadByView = () => {
  useAuthQuery(Queries.subscription.byView())
  const idByView = useSubscriptionStore((state) => state.feedIdByView)
  const totalUnread = useFeedUnreadStore((state) => {
    const unread = {} as Record<number, number>

    for (const view in idByView) {
      unread[view] = idByView[view].reduce(
        (acc: number, feedId: string) => acc + (state.data[feedId] || 0),
        0,
      )
    }
    return unread
  })

  return totalUnread
}

export function FeedColumn({ children }: PropsWithChildren) {
  const carouselRef = useRef<HTMLDivElement>(null)

  const [active, setActive_] = useSidebarActiveView()

  const navigateBackHome = useBackHome(active)
  const setActive: typeof setActive_ = useCallback(
    (args) => {
      const nextActive = typeof args === "function" ? args(active) : args
      setActive_(args)

      if (getReadonlyRoute().location.pathname.startsWith(Routes.Feeds)) {
        navigateBackHome(nextActive)
      }
    },
    [active, navigateBackHome],
  )

  useLayoutEffect(() => {
    const { view } = getRouteParams()
    if (view !== undefined) {
      setActive_(view)
    }
  }, [setActive_])

  useHotkeys(
    shortcuts.feeds.switchBetweenViews.key,
    (e) => {
      e.preventDefault()
      if (isHotkeyPressed("Left")) {
        setActive((i) => {
          if (i === 0) {
            return views.length - 1
          } else {
            return i - 1
          }
        })
      } else {
        setActive((i) => (i + 1) % views.length)
      }
    },
    { scopes: HotKeyScopeMap.Home },
  )

  useWheel(
    ({ event, last, memo: wait = false, direction: [dx], delta: [dex] }) => {
      if (!last) {
        const s = lethargy.check(event)
        if (s) {
          if (!wait && Math.abs(dex) > 20) {
            setActive((i) => clamp(i + dx, 0, views.length - 1))
            return true
          } else {
            return
          }
        } else {
          return false
        }
      } else {
        return false
      }
    },
    {
      target: carouselRef,
    },
  )

  const unreadByView = useUnreadByView()

  const showSidebarUnreadCount = useUISettingKey("sidebarShowUnreadCount")

  useSubscribeElectronEvent("Discover", () => {
    window.router.navigate(Routes.Discover)
  })

  return (
    <WindowUnderBlur
      className="relative flex h-full flex-col space-y-3 rounded-l-[12px] pt-2.5"
      onClick={useCallback(() => navigateBackHome(), [navigateBackHome])}
    >
      <FeedColumnHeader />

      <div
        className="flex w-full justify-between px-3 text-xl text-theme-vibrancyFg"
        onClick={stopPropagation}
      >
        {views.map((item, index) => (
          <ActionButton
            key={item.name}
            tooltip={`${item.name}`}
            shortcut={`${index + 1}`}
            className={cn(
              active === index && item.className,
              "flex flex-col items-center gap-1 text-xl",
              ELECTRON ? "hover:!bg-theme-vibrancyBg" : "",
              showSidebarUnreadCount && "h-11",
            )}
            onClick={(e) => {
              setActive(index)
              e.stopPropagation()
            }}
          >
            {item.icon}
            {showSidebarUnreadCount && (
              <div className="text-[0.625rem] font-medium leading-none">
                {unreadByView[index] > 99 ? (
                  <span className="-mr-0.5">99+</span>
                ) : (
                  unreadByView[index]
                )}
              </div>
            )}
          </ActionButton>
        ))}
      </div>
      <div
        className="relative flex size-full overflow-hidden"
        ref={carouselRef}
      >
        <SwipeWrapper active={active}>
          {views.map((item, index) => (
            <section
              key={item.name}
              className="h-full w-[var(--fo-feed-col-w)] shrink-0 snap-center"
            >
              <FeedList
                className="flex size-full flex-col text-sm"
                view={index}
              />
            </section>
          ))}
        </SwipeWrapper>
      </div>

      {children}
    </WindowUnderBlur>
  )
}

const SwipeWrapper: FC<{
  active: number
  children: React.JSX.Element[]
}> = ({ children, active }) => {
  const reduceMotion = useReduceMotion()

  const feedColumnWidth = useUISettingKey("feedColWidth")
  const containerRef = useRef<HTMLDivElement>(null)

  const prevActiveIndexRef = useRef(-1)
  const [isReady, setIsReady] = useState(false)

  const [direction, setDirection] = useState<"left" | "right">("right")
  const [currentAnimtedActive, setCurrentAnimatedActive] = useState(active)

  useLayoutEffect(() => {
    const prevActiveIndex = prevActiveIndexRef.current
    if (prevActiveIndex !== active) {
      if (prevActiveIndex < active) {
        setDirection("right")
      } else {
        setDirection("left")
      }
    }
    // eslint-disable-next-line @eslint-react/web-api/no-leaked-timeout
    setTimeout(() => {
      setCurrentAnimatedActive(active)
    }, 0)
    if (prevActiveIndexRef.current !== -1) {
      setIsReady(true)
    }
    prevActiveIndexRef.current = active
  }, [active])

  if (reduceMotion) {
    return <div ref={containerRef}>{children[currentAnimtedActive]}</div>
  }

  return (
    <AnimatePresence mode="popLayout">
      <m.div
        className="grow"
        key={currentAnimtedActive}
        initial={
          isReady ?
              {
                x: direction === "right" ? feedColumnWidth : -feedColumnWidth,
              } :
            true
        }
        animate={{ x: 0 }}
        exit={{
          x: direction === "right" ? -feedColumnWidth : feedColumnWidth,
        }}
        transition={{
          x: { type: "spring", stiffness: 700, damping: 40 },
        }}
        ref={containerRef}
      >
        {children[currentAnimtedActive]}
      </m.div>
    </AnimatePresence>
  )
}
