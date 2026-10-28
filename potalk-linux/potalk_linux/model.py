"""ブリッジから届く状態の形と、画面に依存しない小さなロジック。

Mac 版の Models.swift / Windows 版の AppModel.cs と同じ状態を、Python の dataclass で表す。
ここは Qt に触らないので、単体テストで確かめられる。
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field


def _s(d: dict, k: str, default: str = "") -> str:
    v = d.get(k, default)
    return v if isinstance(v, str) else default


def _b(d: dict, k: str) -> bool:
    return bool(d.get(k, False))


@dataclass
class Person:
    em: str = ""
    name: str = ""
    muted: bool = False

    @classmethod
    def from_dict(cls, d: dict) -> "Person":
        return cls(em=_s(d, "em"), name=_s(d, "name"), muted=_b(d, "muted"))


@dataclass
class LobbyRoom:
    id: str = ""
    name: str = ""
    count: str = ""
    sub: str = ""
    sub_by: str = ""
    dur: str = ""
    people: list[Person] = field(default_factory=list)
    bc: bool = False

    @classmethod
    def from_dict(cls, d: dict) -> "LobbyRoom":
        return cls(
            id=_s(d, "id"), name=_s(d, "name"), count=_s(d, "count"),
            sub=_s(d, "sub"), sub_by=_s(d, "subBy"), dur=_s(d, "dur"),
            people=[Person.from_dict(p) for p in d.get("people") or []],
            bc=_b(d, "bc"),
        )


@dataclass
class LobbyState:
    rooms: list[LobbyRoom] = field(default_factory=list)
    status: str = ""
    viewers: str = ""

    @classmethod
    def from_dict(cls, d: dict) -> "LobbyState":
        return cls(
            rooms=[LobbyRoom.from_dict(r) for r in d.get("rooms") or []],
            status=_s(d, "status"), viewers=_s(d, "viewers"),
        )


@dataclass
class Avatar:
    em: str = ""
    on: bool = False

    @classmethod
    def from_dict(cls, d: dict) -> "Avatar":
        return cls(em=_s(d, "em"), on=_b(d, "on"))


@dataclass
class ProfileState:
    emoji: str = ""
    name: str = ""
    input: str = ""
    avatars: list[Avatar] = field(default_factory=list)
    version: str = ""

    @classmethod
    def from_dict(cls, d: dict) -> "ProfileState":
        return cls(
            emoji=_s(d, "emoji"), name=_s(d, "name"), input=_s(d, "input"),
            avatars=[Avatar.from_dict(a) for a in d.get("avatars") or []],
            version=_s(d, "version"),
        )


@dataclass
class Member:
    em: str = ""
    name: str = ""
    mark: str = ""
    muted: bool = False
    speaking: bool = False
    you: bool = False
    stage: str = ""
    tap: bool = False
    conn: str = ""

    @classmethod
    def from_dict(cls, d: dict) -> "Member":
        return cls(
            em=_s(d, "em"), name=_s(d, "name"), mark=_s(d, "mark"),
            muted=_b(d, "muted"), speaking=_b(d, "speaking"), you=_b(d, "you"),
            stage=_s(d, "stage"), tap=_b(d, "tap"), conn=_s(d, "conn"),
        )


@dataclass
class RoomState:
    joined: bool = False
    rid: str = ""
    state: str = ""
    members: list[Member] = field(default_factory=list)
    reactions: list[str] = field(default_factory=list)
    can_mute: bool = False
    muted: bool = False
    share: str = ""
    bcast: bool = False
    more: str = ""
    card: "CardView | None" = None
    ignore_ask: "IgnoreAsk | None" = None
    mail: "MailState | None" = None
    mail_now: "MailNow | None" = None
    raw: dict = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict) -> "RoomState":
        return cls(
            joined=_b(d, "joined"), rid=_s(d, "rid"), state=_s(d, "state"),
            members=[Member.from_dict(m) for m in d.get("members") or []],
            reactions=[r for r in d.get("reactions") or [] if isinstance(r, str)],
            can_mute=_b(d, "canMute"), muted=_b(d, "muted"), share=_s(d, "share"),
            bcast=_b(d, "bcast"), more=_s(d, "more"),
            card=CardView.from_dict(d["card"]) if isinstance(d.get("card"), dict) else None,
            ignore_ask=IgnoreAsk.from_dict(d["ignoreAsk"]) if isinstance(d.get("ignoreAsk"), dict) else None,
            mail=MailState.from_dict(d["mail"]) if isinstance(d.get("mail"), dict) else None,
            mail_now=MailNow.from_dict(d["mailNow"]) if isinstance(d.get("mailNow"), dict) else None,
            raw=d,
        )


@dataclass
class Social:
    t: str = ""
    u: str = ""

    @classmethod
    def from_dict(cls, d: dict) -> "Social":
        return cls(t=_s(d, "t"), u=_s(d, "u"))


@dataclass
class CardView:
    emoji: str = ""
    img: str = ""
    name: str = ""
    state: str = ""
    bio: str = ""
    socials: list[Social] = field(default_factory=list)
    foot: str = ""
    edit: bool = False
    ignore_text: str = ""
    ignore_disabled: bool = False
    has_ignore: bool = False

    @classmethod
    def from_dict(cls, d: dict) -> "CardView":
        ig = d.get("ignore") or {}
        return cls(
            emoji=_s(d, "emoji"), img=_s(d, "img"), name=_s(d, "name"),
            state=_s(d, "state"), bio=_s(d, "bio"),
            socials=[Social.from_dict(s) for s in d.get("socials") or []],
            foot=_s(d, "foot"), edit=_b(d, "edit"),
            ignore_text=_s(ig, "text"), ignore_disabled=_b(ig, "disabled"),
            has_ignore=isinstance(d.get("ignore"), dict),
        )


@dataclass
class IgnoreAsk:
    title: str = ""
    items: list[str] = field(default_factory=list)
    yes: str = ""
    no: str = ""

    @classmethod
    def from_dict(cls, d: dict) -> "IgnoreAsk":
        return cls(
            title=_s(d, "title"),
            items=[x for x in d.get("items") or [] if isinstance(x, str)],
            yes=_s(d, "yes"), no=_s(d, "no"),
        )


@dataclass
class MailBtn:
    i: str = ""
    label: str = ""
    on: bool = False

    @classmethod
    def from_dict(cls, d: dict) -> "MailBtn":
        v = d.get("i", "")
        return cls(i=v if isinstance(v, str) else str(v), label=_s(d, "label"), on=_b(d, "on"))


@dataclass
class MailHead:
    text: str = ""
    btns: list[MailBtn] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: dict) -> "MailHead":
        return cls(text=_s(d, "text"), btns=[MailBtn.from_dict(b) for b in d.get("btns") or []])


@dataclass
class MailBodyItem:
    item: bool = False
    em: str = ""
    who: str = ""
    text: str = ""
    shown: bool = False
    btns: list[MailBtn] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: dict) -> "MailBodyItem":
        return cls(
            item=_b(d, "item"), em=_s(d, "em"), who=_s(d, "who"), text=_s(d, "text"),
            shown=_b(d, "shown"), btns=[MailBtn.from_dict(b) for b in d.get("btns") or []],
        )


@dataclass
class MailState:
    head: list[MailHead] = field(default_factory=list)
    body: list[MailBodyItem] = field(default_factory=list)
    form_ph: str = ""
    form_btn: str = ""
    form_max: int = 0
    has_form: bool = False
    raw: dict = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict) -> "MailState":
        form = d.get("form") or {}
        mx = form.get("max", "")
        try:
            maxv = int(mx)
        except (TypeError, ValueError):
            maxv = 0
        return cls(
            head=[MailHead.from_dict(h) for h in d.get("head") or []],
            body=[MailBodyItem.from_dict(b) for b in d.get("body") or []],
            form_ph=_s(form, "ph"), form_btn=_s(form, "btn"), form_max=maxv,
            has_form=isinstance(d.get("form"), dict), raw=d,
        )


@dataclass
class MailNow:
    cap: str = ""
    who: str = ""
    text: str = ""

    @classmethod
    def from_dict(cls, d: dict) -> "MailNow":
        return cls(cap=_s(d, "cap"), who=_s(d, "who"), text=_s(d, "text"))

    @property
    def empty(self) -> bool:
        return not (self.cap or self.who or self.text)


@dataclass
class CardEditState:
    raw: dict = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict) -> "CardEditState":
        return cls(raw=d)

    def s(self, k: str) -> str:
        return _s(self.raw, k)

    def b(self, k: str) -> bool:
        return _b(self.raw, k)

    def ver(self, k: str) -> dict:
        v = self.raw.get("ver" + k[:1].upper() + k[1:])
        return v if isinstance(v, dict) else {}


@dataclass
class CardAuthState:
    raw: dict = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict) -> "CardAuthState":
        return cls(raw=d)

    def s(self, k: str) -> str:
        return _s(self.raw, k)

    def b(self, k: str) -> bool:
        return _b(self.raw, k)


@dataclass
class ChatLine:
    sys: bool = False
    hist: bool = False
    em: str = ""
    who: str = ""
    text: str = ""

    @classmethod
    def from_dict(cls, d: dict) -> "ChatLine":
        return cls(sys=_b(d, "sys"), hist=_b(d, "hist"), em=_s(d, "em"),
                   who=_s(d, "who"), text=_s(d, "text"))


# ---- ロビーの検索（Mac/Win と同じ作法：全角半角・大小・ひらがなカタカナを区別しない） ----

_KATA = re.compile(r"[ァ-ヶ]")


def normalize(text: str) -> str:
    t = unicodedata.normalize("NFKC", text or "")
    t = _KATA.sub(lambda m: chr(ord(m.group(0)) - 0x60), t)
    return t.lower()


def room_matches(room: LobbyRoom, query: str) -> bool:
    q = normalize(query).strip()
    if not q:
        return True
    if q.startswith("#room=") or "room=" in q:
        rid = q.split("room=", 1)[1].split("&")[0].split(" ")[0]
        return room.id == rid
    hay = normalize(" ".join([
        room.name, room.sub, room.sub_by,
        *[p.name for p in room.people],
    ]))
    return all(part in hay for part in q.split())


def filter_rooms(rooms: list[LobbyRoom], query: str) -> list[LobbyRoom]:
    return [r for r in rooms if room_matches(r, query)]


def choose_drawer_side(win_x: int, win_right: int, scr_x: int, scr_right: int, drawer_w: int) -> str:
    """単一窓モードで、引き出し（ロビー）を本体の左右どちらに出すか決める（Mac 版と同じ規則）。

    左に引き出しの幅だけ空きがあるときは左。左に空きがなく、右にも幅が足りないときも左
    （本体に重ねる側に倒す）。それ以外は右。
    """
    if (win_x - scr_x >= drawer_w) or (scr_right - win_right < drawer_w):
        return "left"
    return "right"


def drawer_x(side: str, win_x: int, win_right: int, drawer_w: int, overlap: int = 24) -> int:
    """引き出しの左端の x。右に出すときは、本体に少し（overlap）重ねる。"""
    if side == "left":
        return win_x - drawer_w
    return win_right - overlap


def parse_room_link(text: str) -> str | None:
    """共有リンク（…#room=…）から hash 部分を取り出す。無ければ None。"""
    i = (text or "").find("#room=")
    if i < 0:
        return None
    return text[i:].split()[0].split("\n")[0]
