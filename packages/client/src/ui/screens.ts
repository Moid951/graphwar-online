import { Constants } from "@graphwar/math";
import { MODE_NAMES } from "../models.js";
import type { Player } from "../models.js";
import type { GameData, GameUI } from "../gameData.js";
import { ComputerPlayer } from "../gameData.js";
import type { GlobalClient } from "../network.js";
import { GraphPlane } from "./plane.js";

const screenIds = [0, 1, 2, 3] as const;

export class GraphUI implements GameUI {
  root: HTMLElement;
  screens: HTMLElement[] = [];
  activeScreen: number = Constants.MAIN_MENU_SCREEN;
  gameData: GameData;
  globalClient: GlobalClient;
  plane: GraphPlane;

  /** game-wide callbacks for screen-level actions */
  onJoinGlobal: (() => void) | null = null;
  onJoinRoom:
    | ((room: { name: string; roomID: number; port: number; private: boolean }) => void)
    | null = null;
  onAddComputerPlayer: (() => void) | null = null;
  onSwitchSide: ((playerID: number) => void) | null = null;
  onAddSoldier: ((playerID: number) => void) | null = null;
  onRemoveSoldier: ((playerID: number) => void) | null = null;
  onRemovePlayer: ((playerID: number) => void) | null = null;
  onSetReady: (() => void) | null = null;
  onSendChatGlobal: ((msg: string) => void) | null = null;
  onSendChatPregame: ((msg: string) => void) | null = null;
  onSendChatGame: ((msg: string) => void) | null = null;
  onFireFunction: ((func: string) => void) | null = null;
  onPreviewFunction: ((func: string) => void) | null = null;
  onAngleUpDown: ((up: boolean, down: boolean) => void) | null = null;
  onStopAngle: (() => void) | null = null;
  onQuit: (() => void) | null = null;
  onBackGlobal: (() => void) | null = null;
  onNextMode: (() => void) | null = null;
  onCreateRoomGlobal: ((name: string, key: string) => void) | null = null;
  onGlobalNameChange: ((name: string) => void) | null = null;
  onGameMessageOk: (() => void) | null = null;
  onStartGame: (() => void) | null = null;
  onCancelStart: (() => void) | null = null;
  onKick: ((playerID: number) => void) | null = null;
  onTransferLeader: ((playerID: number) => void) | null = null;

  private preGamePlayersEl: HTMLElement;
  private globalPlayersEl: HTMLElement;
  private globalRoomsEl: HTMLElement;
  private preGameChatEl: HTMLElement;
  private gameChatEl: HTMLElement;
  private globalChatEl: HTMLElement;
  private actionButton: HTMLButtonElement;
  private modeButton: HTMLButtonElement;

  private roomSubEl: HTMLElement;
  private functionInput: HTMLInputElement;
  private fireButton: HTMLButtonElement;
  private timerEl: HTMLElement;
  private angleDisplayEl: HTMLCanvasElement;
  private angleCtx: CanvasRenderingContext2D;
  private gameMsgPanel: HTMLElement;
  private gameMsgText: HTMLElement;

  constructor(root: HTMLElement, gameData: GameData, globalClient: GlobalClient) {
    this.root = root;
    this.gameData = gameData;
    this.globalClient = globalClient;
    this.plane = new GraphPlane();

    this.buildScreens();
    this.preGamePlayersEl = this.screens[Constants.PRE_GAME_SCREEN].querySelector("#preGamePlayers")! as HTMLElement;
    this.globalPlayersEl = this.screens[Constants.GLOBAL_ROOM_SCREEN].querySelector("#globalPlayers")! as HTMLElement;
    this.globalRoomsEl = this.screens[Constants.GLOBAL_ROOM_SCREEN].querySelector("#globalRooms")! as HTMLElement;
    this.preGameChatEl = this.screens[Constants.PRE_GAME_SCREEN].querySelector("#preGameChat")! as HTMLElement;
    this.gameChatEl = this.screens[Constants.GAME_SCREEN].querySelector("#gameChat")! as HTMLElement;
    this.globalChatEl = this.screens[Constants.GLOBAL_ROOM_SCREEN].querySelector("#globalChat")! as HTMLElement;
    this.actionButton = this.screens[Constants.PRE_GAME_SCREEN].querySelector("#actionBtn")! as HTMLButtonElement;
    this.modeButton = this.screens[Constants.PRE_GAME_SCREEN].querySelector("#modeBtn")! as HTMLButtonElement;

    this.roomSubEl = this.screens[Constants.PRE_GAME_SCREEN].querySelector("#roomSub")! as HTMLElement;
    this.functionInput = this.screens[Constants.GAME_SCREEN].querySelector("#funcField")! as HTMLInputElement;
    this.fireButton = this.screens[Constants.GAME_SCREEN].querySelector("#fireBtn")! as HTMLButtonElement;
    this.timerEl = this.screens[Constants.GAME_SCREEN].querySelector("#timer")! as HTMLElement;
    this.angleDisplayEl = this.screens[Constants.GAME_SCREEN].querySelector("#angleDisplay")! as HTMLCanvasElement;
    this.angleCtx = this.angleDisplayEl.getContext("2d")!;
    this.gameMsgPanel = this.screens[Constants.GAME_SCREEN].querySelector("#gameMsgPanel")! as HTMLElement;
    this.gameMsgText = this.screens[Constants.GAME_SCREEN].querySelector("#gameMsgText")! as HTMLElement;

    this.setScreen(Constants.MAIN_MENU_SCREEN);
    this.applyTheme();
  }

  private applyTheme(): void {
    let theme = "light";
    try {
      const saved = localStorage.getItem("graphwar.theme");
      if (saved === "light" || saved === "dark") theme = saved;
    } catch {
      /* localStorage unavailable (headless) */
    }
    document.documentElement.dataset.theme = theme;
  }

  private toggleTheme(): void {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("graphwar.theme", next);
    } catch {
      /* ignore */
    }
  }

  /** Custom modal prompt replacing window.prompt(). Resolves null on cancel/Escape. */
  prompt(label: string, defaultValue: string): Promise<string | null> {
    return this.promptFields(
      label,
      [{ label, value: defaultValue, id: "modalInput" }],
      "modalInput"
    ).then((vals) => (vals === null ? null : vals[0]));
  }

  /** Modal with one or more fields. Resolves field values, or null on cancel/Escape. */
  promptFields(
    label: string,
    fields: { label: string; value: string; id: string }[],
    focusId?: string
  ): Promise<string[] | null> {
    this.closeModal();
    const built = this.buildModal({
      title: label,
      inputs: fields,
      focusId,
      okId: "modalOkBtn",
      okText: "OK",
      cancelId: "modalCancelBtn",
      cancelText: "Cancel",
    });
    built.focus();
    return new Promise<string[] | null>((resolve) => {
      let done = false;
      const finish = (value: string[] | null): void => {
        if (done) return;
        done = true;
        this.modalCleanup = null;
        built.overlay.remove();
        resolve(value);
      };
      this.modalCleanup = () => finish(null);
      built.ok.addEventListener("click", () => finish(built.inputs.map((i) => i.value)));
      built.cancel.addEventListener("click", () => finish(null));
      built.overlay.addEventListener("click", (ev) => {
        if (ev.target === built.overlay) finish(null);
      });
      for (const input of built.inputs) {
        input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            finish(built.inputs.map((i) => i.value));
          } else if (ev.key === "Escape") {
            finish(null);
          }
        });
      }
    });
  }

  /** Yes/no modal. Resolves true on OK, false on cancel/overlay/Escape. */
  confirm(message: string): Promise<boolean> {
    this.closeModal();
    const built = this.buildModal({
      title: message,
      okId: "confirmOkBtn",
      okText: "OK",
      cancelId: "confirmCancelBtn",
      cancelText: "Cancel",
    });
    return new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (value: boolean): void => {
        if (done) return;
        done = true;
        this.modalCleanup = null;
        built.overlay.remove();
        resolve(value);
      };
      this.modalCleanup = () => finish(false);
      built.ok.addEventListener("click", () => finish(true));
      built.cancel.addEventListener("click", () => finish(false));
      built.overlay.addEventListener("click", (ev) => {
        if (ev.target === built.overlay) finish(false);
      });
    });
  }

  private modalCleanup: (() => void) | null = null;

  private closeModal(): void {
    if (this.modalCleanup !== null) {
      const cleanup = this.modalCleanup;
      this.modalCleanup = null;
      cleanup();
    }
  }

  private buildModal(opts: {
    title: string;
    inputs?: { label: string; value: string; id: string }[];
    focusId?: string;
    okId: string;
    okText: string;
    cancelId: string;
    cancelText: string;
  }): {
    overlay: HTMLElement;
    inputs: HTMLInputElement[];
    ok: HTMLButtonElement;
    cancel: HTMLButtonElement;
    focus: () => void;
  } {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const card = document.createElement("div");
    card.className = "modal";

    const title = document.createElement("div");
    title.className = "modal-title";
    title.textContent = opts.title;
    card.appendChild(title);

    const inputs: HTMLInputElement[] = [];
    for (const f of opts.inputs ?? []) {
      const row = document.createElement("div");
      row.className = "modal-field";
      const lab = document.createElement("label");
      lab.textContent = f.label;
      const input = document.createElement("input");
      input.className = "field";
      input.id = f.id;
      input.value = f.value;
      input.autocomplete = "off";
      row.appendChild(lab);
      row.appendChild(input);
      card.appendChild(row);
      inputs.push(input);
    }

    const ok = document.createElement("button");
    ok.className = "btn";
    ok.id = opts.okId;
    ok.textContent = opts.okText;
    const cancel = document.createElement("button");
    cancel.className = "btn";
    cancel.id = opts.cancelId;
    cancel.textContent = opts.cancelText;
    const btnRow = document.createElement("div");
    btnRow.className = "btn-row";
    btnRow.appendChild(ok);
    btnRow.appendChild(cancel);
    card.appendChild(btnRow);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const focus = (): void => {
      const target =
        opts.focusId !== undefined
          ? (inputs.find((i) => i.id === opts.focusId) ?? inputs[0])
          : inputs[0];
      if (target !== undefined) {
        target.focus();
        target.select();
      }
    };
    return { overlay, inputs, ok, cancel, focus };
  }

  private buildScreens(): void {
    this.screens = [];
    this.root.innerHTML = "";
    for (const id of screenIds) {
      const div = document.createElement("div");
      div.className = "screen";
      div.id = `screen${id}`;
      this.root.appendChild(div);
      this.screens.push(div);
    }

    this.buildMainMenu(this.screens[0]);
    this.buildPreGame(this.screens[1]);
    this.buildGlobalRoom(this.screens[2]);
    this.buildGameScreen(this.screens[3]);
  }

  private makeButton(parent: HTMLElement, text: string, x: number, y: number, id?: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = text;
    btn.style.left = `${x}px`;
    btn.style.top = `${y}px`;
    if (id !== undefined) btn.id = id;
    parent.appendChild(btn);
    return btn;
  }

  private makeField(parent: HTMLElement, x: number, y: number, width: number, id?: string): HTMLInputElement {
    const input = document.createElement("input");
    input.className = "field";
    input.style.left = `${x}px`;
    input.style.top = `${y}px`;
    input.style.width = `${width}px`;
    if (id !== undefined) input.id = id;
    parent.appendChild(input);
    return input;
  }

  private makeLog(parent: HTMLElement, x: number, y: number, w: number, h: number, id?: string): HTMLElement {
    const log = document.createElement("div");
    log.className = "log";
    log.style.left = `${x}px`;
    log.style.top = `${y}px`;
    log.style.width = `${w}px`;
    log.style.height = `${h}px`;
    if (id !== undefined) log.id = id;
    parent.appendChild(log);
    return log;
  }

  /** Button for flex-layout screens (no absolute inline coords). */
  private flexButton(text: string, id?: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "btn";
    b.textContent = text;
    if (id !== undefined) b.id = id;
    return b;
  }

  /** Input for flex-layout screens (no absolute inline coords). */
  private flexField(id?: string): HTMLInputElement {
    const f = document.createElement("input");
    f.className = "field";
    if (id !== undefined) f.id = id;
    return f;
  }

  /** Labeled field group for flex panels. */
  private labeledField(label: string, id?: string): { wrap: HTMLElement; input: HTMLInputElement } {
    const wrap = document.createElement("label");
    wrap.className = "field-group";
    const span = document.createElement("span");
    span.className = "field-label";
    span.textContent = label;
    const input = this.flexField(id);
    wrap.append(span, input);
    return { wrap, input };
  }

  getGlobalName(): string {
    return this.getMenuName();
  }

  setGlobalName(name: string): void {
    const field = this.screens[Constants.MAIN_MENU_SCREEN].querySelector("#menuNameField");
    if (field !== null) (field as HTMLInputElement).value = name;
    const navUser = document.getElementById("navUser");
    if (navUser !== null) navUser.textContent = name;
  }

  private buildMainMenu(screen: HTMLElement): void {
    screen.classList.add("menu");

    const head = document.createElement("header");
    head.className = "menu-head";
    const brand = document.createElement("h1");
    brand.className = "brand";
    brand.textContent = "Graphwar";
    head.appendChild(brand);
    screen.appendChild(head);

    const body = document.createElement("div");
    body.className = "menu-body";
    const nameWrap = document.createElement("div");
    nameWrap.className = "field-group";
    const nameLabel = document.createElement("div");
    nameLabel.className = "field-label";
    nameLabel.textContent = "Your name";
    const nameField = this.flexField("menuNameField");
    nameField.placeholder = "Your name";
    nameWrap.append(nameLabel, nameField);
    const playBtn = this.flexButton("Play", "playBtn");
    playBtn.classList.add("primary");
    body.append(nameWrap, playBtn);
    screen.appendChild(body);

    nameField.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && this.onJoinGlobal !== null) this.onJoinGlobal();
    });
    screen.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement;
      if (target.id === "playBtn" && this.onJoinGlobal !== null) this.onJoinGlobal();
    });
  }

  getMenuName(): string {
    const field = this.screens[Constants.MAIN_MENU_SCREEN].querySelector("#menuNameField");
    return field instanceof HTMLInputElement ? field.value : "";
  }

  private hiddenPanels: HTMLElement[] = [];
  private showPanel(p: HTMLElement): void {
    this.hidePanels();
    p.style.display = "flex";
  }
  private hidePanels(): void {
    for (const p of this.hiddenPanels) p.style.display = "none";
  }

  private makeSubPanel(parent: HTMLElement, w: number, h: number): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "screen panel";
    panel.style.width = `${w}px`;
    panel.style.height = `${h}px`;
    panel.style.position = "absolute";
    panel.style.left = "184px";
    panel.style.top = "184px";
    parent.appendChild(panel);
    return panel;
  }

  private buildPreGame(screen: HTMLElement): void {
    screen.classList.add("room");

    /* ---- fixed header ---- */
    const head = document.createElement("header");
    head.className = "room-head";
    const titleWrap = document.createElement("div");
    titleWrap.className = "room-title";
    const title = document.createElement("h1");
    title.className = "brand";
    title.textContent = "Room";
    const sub = document.createElement("div");
    sub.className = "room-sub";
    sub.id = "roomSub";
    sub.textContent = "0/10 players · Normal";
    titleWrap.append(title, sub);
    const conn = document.createElement("div");
    conn.className = "room-conn";
    conn.textContent = "\u25CF Connected";
    head.append(titleWrap, conn);
    screen.appendChild(head);

    /* ---- main: table + chat ---- */
    const main = document.createElement("div");
    main.className = "room-main";

    /* -- left: player table -- */
    const playersSection = document.createElement("section");
    playersSection.className = "room-players";

    const tableHead = document.createElement("div");
    tableHead.className = "player-table-head";
    for (const [label, cls] of [["Player", "col-player"], ["Team", "col-team"], ["Soldiers", "col-soldiers"], ["Status", "col-status"], ["", "col-actions"]] as const) {
      const span = document.createElement("span");
      span.textContent = label;
      span.className = cls;
      tableHead.appendChild(span);
    }
    playersSection.appendChild(tableHead);

    const playerTable = document.createElement("div");
    playerTable.className = "player-table";
    playerTable.id = "preGamePlayers";
    playersSection.appendChild(playerTable);
    main.appendChild(playersSection);

    /* -- right: chat (3-tier: header + log + input) -- */
    const chat = document.createElement("section");
    chat.className = "room-chat";
    const chatHead = document.createElement("div");
    chatHead.className = "room-chat-head";
    chatHead.textContent = "Room Chat";
    chat.appendChild(chatHead);
    const chatLog = document.createElement("div");
    chatLog.className = "log";
    chatLog.id = "preGameChat";
    const chatInputRow = document.createElement("div");
    chatInputRow.className = "chat-input-row";
    const chatField = this.flexField("preGameChatField");
    chatField.placeholder = "Type a message...";
    chatField.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && this.onSendChatPregame !== null) {
        this.onSendChatPregame(chatField.value);
        chatField.value = "";
      }
    });
    const chatSendBtn = this.flexButton("Send", "preGameChatSendBtn");
    chatSendBtn.classList.add("primary");
    chatSendBtn.style.padding = "4px 12px";
    chatSendBtn.style.fontSize = "12px";
    chatSendBtn.addEventListener("click", () => {
      if (this.onSendChatPregame !== null) {
        this.onSendChatPregame(chatField.value);
        chatField.value = "";
      }
    });
    chatInputRow.append(chatField, chatSendBtn);
    chat.append(chatLog, chatInputRow);
    main.appendChild(chat);
    screen.appendChild(main);

    /* ---- fixed footer ---- */
    const foot = document.createElement("footer");
    foot.className = "room-foot";
    const backBtn = this.flexButton("Leave Room", "preGameBackBtn");
    backBtn.classList.add("ghost");
    const modeGroup = document.createElement("div");
    modeGroup.className = "room-mode";
    const modeLabel = document.createElement("span");
    modeLabel.className = "field-label";
    modeLabel.textContent = "Game Mode";
    const modeBtn = this.flexButton("Normal", "modeBtn");
    modeGroup.append(modeLabel, modeBtn);
    const spacer = document.createElement("div");
    spacer.className = "spacer";
    const actionBtn = this.flexButton("Ready", "actionBtn");
    actionBtn.classList.add("primary");
    foot.append(backBtn, modeGroup, spacer, actionBtn);
    screen.appendChild(foot);

    /* ---- panels ---- */
    const msgPanel = this.makeSubPanel(screen, 300, 160);
    msgPanel.classList.add("msg-panel");
    msgPanel.style.left = `calc(50% - 150px)`;
    msgPanel.style.top = `calc(50% - 80px)`;
    const msgText = document.createElement("div");
    msgText.className = "msg-text";
    msgPanel.appendChild(msgText);
    const msgOk = this.flexButton("Ok", "preGameMsgOkBtn");
    msgOk.classList.add("primary");
    msgPanel.appendChild(msgOk);
    msgPanel.style.display = "none";
    this.preGameMsgPanel = msgPanel;
    this.preGameMsgText = msgText;

    /* ---- event delegation ---- */
    screen.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement;
      switch (target.id) {
        case "addAiRow":
          if (this.onAddComputerPlayer !== null) this.onAddComputerPlayer();
          break;
        case "readyBtn":
        case "actionBtn":
          if (this.preGameCountdownActive) {
            if (this.gameData.leader && this.onCancelStart !== null) {
              this.onCancelStart();
            } else if (!this.gameData.leader && this.onSetReady !== null) {
              this.onSetReady();
            }
          } else if (this.gameData.leader) {
            if (this.onStartGame !== null) this.onStartGame();
          } else {
            if (this.onSetReady !== null) this.onSetReady();
          }
          break;
        case "modeBtn":
          if (this.onNextMode !== null) this.onNextMode();
          break;
        case "preGameBackBtn":
          if (this.onBackGlobal !== null) this.onBackGlobal();
          break;
        case "preGameMsgOkBtn":
          this.preGameMsgPanel.style.display = "none";
          break;
      }
      /* team toggle */
      if (target.classList.contains("team-toggle-btn")) {
        const row = target.closest(".player-table-row") as HTMLElement | null;
        if (row !== null) {
          const pid = parseInt(row.dataset.pid ?? "", 10);
          const newTeam = parseInt(target.dataset.team ?? "", 10);
          if (!Number.isNaN(pid) && !Number.isNaN(newTeam) && this.onSwitchSide !== null) {
            const player = this.gameData.getPlayer(pid);
            if (player !== null && player.team !== newTeam) this.onSwitchSide(pid);
          }
        }
      }
      /* soldier stepper */
      if (target.classList.contains("stepper-btn")) {
        const row = target.closest(".player-table-row") as HTMLElement | null;
        if (row !== null) {
          const pid = parseInt(row.dataset.pid ?? "", 10);
          if (!Number.isNaN(pid)) {
            const isAdd = target.dataset.action === "add";
            if (isAdd && this.onAddSoldier !== null) this.onAddSoldier(pid);
            if (!isAdd && this.onRemoveSoldier !== null) this.onRemoveSoldier(pid);
          }
        }
      }
      /* kick */
      if (target.classList.contains("kick-btn") && this.onKick !== null) {
        const pid = parseInt(target.dataset.pid ?? "", 10);
        if (!Number.isNaN(pid)) this.onKick(pid);
      }
    });
  }

  private preGameMsgPanel!: HTMLElement;
  private preGameMsgText!: HTMLElement;
  private globalMsgPanel!: HTMLElement;
  private globalMsgText!: HTMLElement;

  private globalRoomSearchField!: HTMLInputElement;
  private globalRoomModeFilter!: HTMLSelectElement;
  private globalRoomStatusFilter!: HTMLSelectElement;
  private socialTabChat!: HTMLElement;
  private socialTabOnline!: HTMLElement;
  private socialPanelChat!: HTMLElement;
  private socialPanelOnline!: HTMLElement;

  private buildGlobalRoom(screen: HTMLElement): void {
    screen.classList.add("global");

    /* ---- nav bar ---- */
    const nav = document.createElement("nav");
    nav.className = "nav-bar";
    const brand = document.createElement("h1");
    brand.className = "brand";
    brand.textContent = "Graphwar";
    const navRight = document.createElement("div");
    navRight.className = "nav-right";
    const themeBtn = this.flexButton("Theme", "themeBtn");
    themeBtn.classList.add("ghost");
    themeBtn.addEventListener("click", () => this.toggleTheme());
    const userLabel = document.createElement("span");
    userLabel.className = "nav-user";
    userLabel.id = "navUser";
    navRight.append(themeBtn, userLabel);
    nav.append(brand, navRight);
    screen.appendChild(nav);

    /* ---- main 2-col ---- */
    const main = document.createElement("div");
    main.className = "global-main";

    /* -- left: rooms -- */
    const roomsSection = document.createElement("section");
    roomsSection.className = "global-rooms";

    const toolbar = document.createElement("div");
    toolbar.className = "global-rooms-toolbar";
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.className = "search-field";
    searchInput.placeholder = "Search rooms...";
    this.globalRoomSearchField = searchInput;

    const modeFilter = document.createElement("select");
    modeFilter.className = "toolbar-select";
    for (const opt of ["All Modes", "Normal", "FST ODE", "SND ODE"]) {
      const o = document.createElement("option");
      o.textContent = opt;
      modeFilter.appendChild(o);
    }
    this.globalRoomModeFilter = modeFilter;

    const statusFilter = document.createElement("select");
    statusFilter.className = "toolbar-select";
    for (const opt of ["All", "Public", "Private"]) {
      const o = document.createElement("option");
      o.textContent = opt;
      statusFilter.appendChild(o);
    }
    this.globalRoomStatusFilter = statusFilter;

    const toolbarSpacer = document.createElement("div");
    toolbarSpacer.style.flex = "1";

    const createRoomBtn = this.flexButton("+ Create Room", "createRoomBtn");
    createRoomBtn.classList.add("primary");
    toolbar.append(searchInput, modeFilter, statusFilter, toolbarSpacer, createRoomBtn);
    roomsSection.appendChild(toolbar);

    const roomsHead = document.createElement("div");
    roomsHead.className = "rooms-head";
    for (const [label, cls] of [["Name", "room-name"], ["Mode", "col-mode"], ["Players", "col-players"], ["Status", "col-status"], ["", "col-action"]] as const) {
      const span = document.createElement("span");
      span.textContent = label;
      span.className = cls;
      roomsHead.appendChild(span);
    }
    roomsSection.appendChild(roomsHead);

    const rooms = document.createElement("div");
    rooms.className = "rooms-list";
    rooms.id = "globalRooms";
    roomsSection.appendChild(rooms);
    main.appendChild(roomsSection);

    /* -- right: social tabs -- */
    const social = document.createElement("aside");
    social.className = "global-social";

    const tabs = document.createElement("div");
    tabs.className = "social-tabs";
    const tabChat = document.createElement("div");
    tabChat.className = "social-tab active";
    tabChat.textContent = "Chat";
    tabChat.dataset.tab = "chat";
    const tabOnline = document.createElement("div");
    tabOnline.className = "social-tab";
    tabOnline.textContent = "Online";
    tabOnline.dataset.tab = "online";
    tabs.append(tabChat, tabOnline);
    this.socialTabChat = tabChat;
    this.socialTabOnline = tabOnline;
    social.appendChild(tabs);

    /* chat panel */
    const chatPanel = document.createElement("div");
    chatPanel.className = "social-panel active";
    chatPanel.dataset.tabContent = "chat";
    const chatLog = document.createElement("div");
    chatLog.className = "chat-log";
    chatLog.id = "globalChat";
    const chatInputRow = document.createElement("div");
    chatInputRow.className = "chat-input-row";
    const chatField = this.flexField("globalChatField");
    chatField.placeholder = "Type a message...";
    chatField.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && this.onSendChatGlobal !== null) {
        this.onSendChatGlobal(chatField.value);
        chatField.value = "";
      }
    });
    const chatSend = this.flexButton("Send", "globalChatSendBtn");
    chatSend.classList.add("primary");
    chatSend.addEventListener("click", () => {
      if (this.onSendChatGlobal !== null) {
        this.onSendChatGlobal(chatField.value);
        chatField.value = "";
      }
    });
    chatInputRow.append(chatField, chatSend);
    chatPanel.append(chatLog, chatInputRow);
    this.socialPanelChat = chatPanel;
    social.appendChild(chatPanel);

    /* online panel */
    const onlinePanel = document.createElement("div");
    onlinePanel.className = "social-panel";
    onlinePanel.dataset.tabContent = "online";
    const onlineList = document.createElement("div");
    onlineList.className = "online-list";
    onlineList.id = "globalPlayers";
    onlinePanel.appendChild(onlineList);
    this.socialPanelOnline = onlinePanel;
    social.appendChild(onlinePanel);

    main.appendChild(social);
    screen.appendChild(main);

    /* tab switching */
    tabs.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement;
      if (!target.classList.contains("social-tab")) return;
      const tab = target.dataset.tab;
      this.socialTabChat.classList.toggle("active", tab === "chat");
      this.socialTabOnline.classList.toggle("active", tab === "online");
      this.socialPanelChat.classList.toggle("active", tab === "chat");
      this.socialPanelOnline.classList.toggle("active", tab === "online");
    });

    /* search/filter on input */
    const applyFilters = (): void => {
      this.globalRefreshRooms();
    };
    searchInput.addEventListener("input", applyFilters);
    modeFilter.addEventListener("change", applyFilters);
    statusFilter.addEventListener("change", applyFilters);

    /* ---- create room panel (modal-like) ---- */
    const createPanel = this.makeSubPanel(screen, 260, 240);
    createPanel.classList.add("menu-panel");
    createPanel.style.left = `calc(50% - 130px)`;
    createPanel.style.top = `calc(50% - 120px)`;
    const nameField2 = this.labeledField("Name", "globalCreateName");
    nameField2.input.placeholder = "Room";
    nameField2.input.value = "Room";
    const privRow = document.createElement("label");
    privRow.className = "field-group row-line";
    const privChk = document.createElement("input");
    privChk.type = "checkbox";
    privChk.id = "globalCreatePrivate";
    const privSpan = document.createElement("span");
    privSpan.className = "field-label";
    privSpan.textContent = "Private room";
    privRow.append(privChk, privSpan);
    const keyField = this.labeledField("Key", "globalCreateKey");
    keyField.input.placeholder = "join key";
    keyField.input.disabled = true;
    privChk.addEventListener("change", () => {
      keyField.input.disabled = !privChk.checked;
      if (!privChk.checked) keyField.input.value = "";
    });
    const goBtn = this.flexButton("Create", "globalCreateGoBtn");
    goBtn.classList.add("primary");
    const cancelBtn = this.flexButton("Back", "globalCreateBackBtn");
    createPanel.append(nameField2.wrap, privRow, keyField.wrap, goBtn, cancelBtn);
    createPanel.style.display = "none";
    this.hiddenPanels.push(createPanel);

    /* ---- message panel ---- */
    const msgPanel = this.makeSubPanel(screen, 300, 140);
    msgPanel.id = "globalMsgPanel";
    msgPanel.classList.add("msg-panel");
    msgPanel.style.left = `calc(50% - 150px)`;
    msgPanel.style.top = `calc(50% - 70px)`;
    const msgText = document.createElement("div");
    msgText.className = "msg-text";
    msgText.id = "globalMsgText";
    msgPanel.appendChild(msgText);
    const msgOk = this.flexButton("Ok", "globalMsgOkBtn");
    msgOk.classList.add("primary");
    msgPanel.appendChild(msgOk);
    msgPanel.style.display = "none";
    this.globalMsgPanel = msgPanel;
    this.globalMsgText = msgText;

    /* ---- event delegation ---- */
    screen.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement;
      switch (target.id) {
        case "createRoomBtn":
          this.showPanel(createPanel);
          break;
        case "globalCreateGoBtn": {
          const name = nameField2.input.value;
          const isPrivate = privChk.checked;
          const key = keyField.input.value;
          if (name.length === 0) {
            this.showGlobalMessage("Enter a room name.");
          } else if (isPrivate && key.length === 0) {
            this.showGlobalMessage("Set a key for the private room.");
          } else {
            if (this.onCreateRoomGlobal !== null) this.onCreateRoomGlobal(name, isPrivate ? key : "");
            this.hidePanels();
          }
          break;
        }
        case "globalCreateBackBtn":
          this.hidePanels();
          break;
        case "globalMsgOkBtn":
          this.globalMsgPanel.style.display = "none";
          break;
      }
      /* join-btn click */
      if (target.classList.contains("join-btn")) {
        const row = target.closest(".row.cols") as HTMLElement | null;
        if (row !== null) {
          const roomId = parseInt(row.dataset.roomId ?? "", 10);
          const room = this.globalClient.rooms.find((r) => r.roomID === roomId);
          if (room !== undefined) this.triggerJoin(room);
        }
      }
    });
  }

  private buildGameScreen(screen: HTMLElement): void {
    screen.classList.add("game");
    /* ---- canvas (70%) ---- */
    const container = document.createElement("div");
    container.id = "planeContainer";
    container.className = "game-canvas-wrap";
    container.appendChild(this.plane.canvas);
    this.plane.canvas.style.width = "100%";
    this.plane.canvas.style.height = "100%";
    screen.appendChild(container);

    /* ---- bottom control bar (30%) ---- */
    const bar = document.createElement("div");
    bar.className = "game-controls";

    /* left: angle display */
    const leftCol = document.createElement("div");
    leftCol.className = "gc-left";
    const timer = document.createElement("div");
    timer.id = "timer";
    timer.className = "timer";
    const angle = document.createElement("canvas");
    angle.id = "angleDisplay";
    angle.className = "angle-display";
    angle.width = 100;
    angle.height = 100;
    leftCol.append(timer, angle);
    bar.appendChild(leftCol);

    /* center: function input + actions */
    const centerCol = document.createElement("div");
    centerCol.className = "gc-center";
    const topRow = document.createElement("div");
    topRow.className = "gc-center-top";
    const funcField = document.createElement("input");
    funcField.className = "field";
    funcField.id = "funcField";
    funcField.placeholder = "function";
    funcField.addEventListener("input", () => {
      if (this.onPreviewFunction !== null) this.onPreviewFunction(funcField.value);
    });
    funcField.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && this.onFireFunction !== null) {
        this.onFireFunction(funcField.value);
      }
      if (this.gameData.gameMode === Constants.SND_ODE) {
        if (ev.key === "ArrowUp" && this.onAngleUpDown !== null) {
          this.onAngleUpDown(true, false);
          ev.preventDefault();
        }
        if (ev.key === "ArrowDown" && this.onAngleUpDown !== null) {
          this.onAngleUpDown(false, true);
          ev.preventDefault();
        }
      }
    });
    funcField.addEventListener("keyup", (ev) => {
      if (this.gameData.gameMode === Constants.SND_ODE) {
        if (ev.key === "ArrowUp" || ev.key === "ArrowDown") {
          if (this.onStopAngle !== null) this.onStopAngle();
        }
      }
    });
    this.functionInput = funcField;
    const fireBtn = document.createElement("button");
    fireBtn.className = "btn primary";
    fireBtn.id = "fireBtn";
    fireBtn.textContent = "Fire";
    this.fireButton = fireBtn;
    topRow.append(funcField, fireBtn);
    const botRow = document.createElement("div");
    botRow.className = "gc-center-bot";
    const globalBtn = document.createElement("button");
    globalBtn.className = "btn ghost";
    globalBtn.id = "gameGlobalBtn";
    globalBtn.textContent = "Global";
    const quitBtn = document.createElement("button");
    quitBtn.className = "btn ghost";
    quitBtn.id = "quitBtn";
    quitBtn.textContent = "Quit";
    botRow.append(globalBtn, quitBtn);
    centerCol.append(topRow, botRow);
    bar.appendChild(centerCol);

    /* right: chat */
    const rightCol = document.createElement("div");
    rightCol.className = "gc-right";
    const chatLog = document.createElement("div");
    chatLog.className = "log";
    chatLog.id = "gameChat";
    this.gameChatEl = chatLog;
    const chatInputRow = document.createElement("div");
    chatInputRow.className = "chat-input-row";
    const chatField = document.createElement("input");
    chatField.className = "field";
    chatField.id = "gameChatField";
    chatField.placeholder = "chat";
    chatField.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && this.onSendChatGame !== null) {
        this.onSendChatGame(chatField.value);
        chatField.value = "";
      }
    });
    const chatSend = document.createElement("button");
    chatSend.className = "btn primary";
    chatSend.id = "gameChatSendBtn";
    chatSend.textContent = "Send";
    chatSend.style.position = "static";
    chatSend.style.padding = "4px 12px";
    chatSend.style.fontSize = "12px";
    chatSend.addEventListener("click", () => {
      if (this.onSendChatGame !== null) {
        this.onSendChatGame(chatField.value);
        chatField.value = "";
      }
    });
    chatInputRow.append(chatField, chatSend);
    rightCol.append(chatLog, chatInputRow);
    bar.appendChild(rightCol);

    screen.appendChild(bar);

    /* ---- message panel (overlay) ---- */
    const msgPanel = this.makeSubPanel(screen, 184, 184);
    msgPanel.style.left = `calc(50% - 92px)`;
    msgPanel.style.top = `calc(50% - 92px)`;
    msgPanel.id = "gameMsgPanel";
    const msgText = document.createElement("div");
    msgText.id = "gameMsgText";
    msgText.style.width = "385px";
    msgText.style.height = "50px";
    msgText.style.fontSize = "12px";
    msgPanel.appendChild(msgText);
    this.makeButton(msgPanel, "Ok", 100, 140, "gameMsgOkBtn");
    msgPanel.style.display = "none";

    /* ---- click delegation ---- */
    screen.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement;
      switch (target.id) {
        case "fireBtn":
          if (this.onFireFunction !== null) this.onFireFunction(funcField.value);
          break;
        case "quitBtn":
          if (this.onQuit !== null) this.onQuit();
          break;
        case "gameGlobalBtn":
          if (this.onJoinGlobal !== null) this.onJoinGlobal();
          break;
        case "gameMsgOkBtn":
          this.gameMsgPanel.style.display = "none";
          if (this.onGameMessageOk !== null) this.onGameMessageOk();
          break;
      }
    });
  }

  setScreen(id: number): void {
    this.activeScreen = id;
    for (let i = 0; i < this.screens.length; i++) {
      this.screens[i].classList.toggle("active", i === id);
    }
  }

  /** Render loop the main game screen drives. */
  renderGame(): void {
    if (this.activeScreen !== Constants.GAME_SCREEN) return;
    const gd = this.gameData;
    if (gd.gameState !== Constants.GAME) return;

    this.plane.render(gd);
    gd.updateDrawingStuff();

    const remaining = gd.getRemainingTime();
    const tenths = Math.floor(remaining / 100);
    this.timerEl.textContent = String(tenths / 10);
    this.timerEl.style.color = tenths < 50 ? "#d33" : "";
    this.drawAngle(gd);
  }

  private drawAngle(gd: GameData): void {
    const ctx = this.angleCtx;
    const w = this.angleDisplayEl.width;
    const h = this.angleDisplayEl.height;
    ctx.clearRect(0, 0, w, h);

    const player = gd.getCurrentTurnPlayer();
    const soldier = player.getCurrentTurnSoldier();
    const angle = gd.isAngleUp() || gd.isAngleDown() ? gd.getAngle() : soldier.angle;

    const cx = w / 2;
    const cy = h / 2;
    const reversed = gd.isFunctionReversed() !== gd.isTerrainReversed();

    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(4, 57);
    ctx.lineTo(111, 57);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(57, 5);
    ctx.lineTo(57, 111);
    ctx.stroke();

    ctx.fillStyle = player.color;
    if (reversed) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, 30, Math.PI, Math.PI + angle, false);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, 30, 0, -angle, true);
      ctx.closePath();
      ctx.fill();
    }

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    if (reversed) {
      ctx.lineTo(cx - 53 * Math.cos(angle), cy + 53 * Math.sin(angle));
    } else {
      ctx.lineTo(cx + 53 * Math.cos(angle), cy + 53 * Math.sin(angle));
    }
    ctx.stroke();

    ctx.fillStyle = "#000";
    ctx.font = "14px sans-serif";
    const deg = (angle * 180) / Math.PI;
    ctx.fillText(`${String(Math.round(deg * 100) / 100)}°`, 8, 20);
  }

  // ---- GameUI implementation ----

  chatPregame(_player: Player | null, message: string): void {
    this.appendChat(this.preGameChatEl, _player, message);
  }

  chatGame(player: Player | null, message: string): void {
    this.appendChat(this.gameChatEl, player, message);
  }

  private appendChat(el: HTMLElement, player: Player | null, message: string): void {
    const line = document.createElement("div");
    if (player === null) {
      const span = document.createElement("span");
      span.className = "system";
      span.textContent = message;
      line.appendChild(span);
    } else {
      const name = document.createElement("span");
      name.className = "name";
      name.style.color = player.color;
      name.textContent = `${player.name}: `;
      line.appendChild(name);
      line.appendChild(document.createTextNode(message));
    }
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }

  preGameAddPlayer(p: Player): void {
    this.refreshPreGamePlayers();
  }
  preGameRemovePlayer(p: Player): void {
    this.refreshPreGamePlayers();
  }
  preGameUpdatePlayer(p: Player): void {
    this.refreshPreGamePlayers();
  }
  preGameSetMode(mode: number): void {
    this.modeButton.textContent = MODE_NAMES[mode] ?? String(mode);
    this.updateRoomSub();
  }
  preGameSetReadyButtonOn(on: boolean): void {
    this.preGameReadyOn = on;
    this.updateActionButton();
  }
  preGameSetCountdownActive(active: boolean): void {
    this.preGameCountdownActive = active;
    this.updateActionButton();
  }
  private preGameReadyOn = false;
  private preGameCountdownActive = false;
  private updateActionButton(): void {
    const leader = this.gameData.leader;
    if (this.preGameCountdownActive) {
      this.actionButton.textContent = "Cancel";
      this.actionButton.disabled = false;
      this.actionButton.classList.add("primary");
    } else if (leader) {
      this.actionButton.textContent = "Start Game";
      this.actionButton.disabled = false;
      this.actionButton.classList.add("primary");
    } else {
      this.actionButton.textContent = this.preGameReadyOn ? "✓ Ready" : "Ready";
      this.actionButton.disabled = false;
      this.actionButton.classList.add("primary");
    }
    this.modeButton.disabled = !leader;
  }
  private updateRoomSub(): void {
    const mode = MODE_NAMES[this.gameData.gameMode] ?? String(this.gameData.gameMode);
    this.roomSubEl.textContent = `${this.gameData.players.length}/${Constants.MAX_PLAYERS} players · ${mode}`;
  }
  preGameRepaint(): void {
    this.refreshPreGamePlayers();
  }
  preGameShowMessage(msg: string): void {
    this.preGameMsgText.textContent = msg;
    this.preGameMsgPanel.style.display = "flex";
  }
  preGameRefreshBoard(): void {
    this.refreshPreGamePlayers();
  }
  preGameRestartScreen(): void {
    this.preGameChatEl.innerHTML = "";
    this.refreshPreGamePlayers();
  }

  private refreshPreGamePlayers(): void {
    this.preGamePlayersEl.innerHTML = "";
    const isLeader = this.gameData.leader;
    this.modeButton.disabled = !isLeader;
    this.updateRoomSub();
    this.updateActionButton();

    for (const p of this.gameData.players) {
      const isAI = p instanceof ComputerPlayer;
      const isHost = this.gameData.leaderPlayerID === p.playerID;
      const canEdit = p.localPlayer || isLeader;

      const row = document.createElement("div");
      row.className = "player-table-row";
      row.dataset.pid = String(p.playerID);

      /* Col 1: Player */
      const colPlayer = document.createElement("div");
      colPlayer.className = "ptr-player";
      const avatar = document.createElement("div");
      avatar.className = "ptr-avatar";
      avatar.style.background = p.color;
      avatar.textContent = p.name.charAt(0).toUpperCase();
      const playerName = document.createElement("span");
      playerName.className = "ptr-name";
      playerName.textContent = p.name;
      playerName.style.color = p.color;
      const badges = document.createElement("div");
      badges.className = "ptr-badges";
      if (p.localPlayer) {
        const youBadge = document.createElement("span");
        youBadge.className = "badge you";
        youBadge.textContent = "YOU";
        badges.appendChild(youBadge);
      }
      if (isHost) {
        const hostBadge = document.createElement("span");
        hostBadge.className = "badge host";
        hostBadge.textContent = "HOST";
        badges.appendChild(hostBadge);
      }
      if (isAI) {
        const aiBadge = document.createElement("span");
        aiBadge.className = "badge ai";
        aiBadge.textContent = "AI";
        badges.appendChild(aiBadge);
      }
      colPlayer.append(avatar, playerName, badges);
      row.appendChild(colPlayer);

      /* Col 2: Team toggle */
      const colTeam = document.createElement("div");
      colTeam.className = "ptr-team";
      const toggle = document.createElement("div");
      toggle.className = "team-toggle";
      const t1Btn = document.createElement("button");
      t1Btn.className = `team-toggle-btn${p.team === 1 ? " active-t1" : ""}`;
      t1Btn.textContent = "T1";
      t1Btn.dataset.team = "1";
      const t2Btn = document.createElement("button");
      t2Btn.className = `team-toggle-btn${p.team === 2 ? " active-t2" : ""}`;
      t2Btn.textContent = "T2";
      t2Btn.dataset.team = "2";
      toggle.append(t1Btn, t2Btn);
      if (!canEdit) toggle.style.opacity = "0.4";
      colTeam.appendChild(toggle);
      row.appendChild(colTeam);

      /* Col 3: Soldiers stepper */
      const colSoldiers = document.createElement("div");
      colSoldiers.className = "ptr-soldiers";
      const stepper = document.createElement("div");
      stepper.className = "stepper";
      const minusBtn = document.createElement("button");
      minusBtn.className = "stepper-btn";
      minusBtn.textContent = "\u2212";
      minusBtn.dataset.action = "remove";
      const valSpan = document.createElement("span");
      valSpan.className = "stepper-val";
      valSpan.textContent = String(p.numSoldiers);
      const plusBtn = document.createElement("button");
      plusBtn.className = "stepper-btn";
      plusBtn.textContent = "+";
      plusBtn.dataset.action = "add";
      stepper.append(minusBtn, valSpan, plusBtn);
      if (!canEdit) stepper.style.opacity = "0.4";
      colSoldiers.appendChild(stepper);
      row.appendChild(colSoldiers);

      /* Col 4: Status */
      const colStatus = document.createElement("div");
      colStatus.className = "ptr-status";
      const statusBadge = document.createElement("span");
      statusBadge.className = `status-badge ${p.ready || isHost ? "ready" : "not-ready"}`;
      statusBadge.textContent = p.ready || isHost ? "Ready" : "Not Ready";
      colStatus.appendChild(statusBadge);
      row.appendChild(colStatus);

      /* Col 5: Actions (kick for host only, non-host non-local) */
      const colActions = document.createElement("div");
      colActions.className = "ptr-actions";
      if (isLeader && !p.localPlayer) {
        const kickBtn = document.createElement("button");
        kickBtn.className = "btn ghost mini danger kick-btn";
        kickBtn.textContent = "Kick";
        kickBtn.dataset.pid = String(p.playerID);
        kickBtn.style.position = "static";
        colActions.appendChild(kickBtn);
      }
      row.appendChild(colActions);

      this.preGamePlayersEl.appendChild(row);
    }

    /* single + Add AI row */
    if (this.gameData.players.length < 10 && isLeader) {
      const addRow = document.createElement("div");
      addRow.className = "player-table-empty add-ai-row";
      addRow.id = "addAiRow";
      const av = document.createElement("div");
      av.className = "ptr-avatar";
      av.textContent = "+";
      const txt = document.createElement("span");
      txt.textContent = "+ Add AI";
      addRow.append(av, txt);
      this.preGamePlayersEl.appendChild(addRow);
    }
  }

  gameStartDrawingFunction(): void {}
  gameUpdateFunction(func: string): void {
    this.functionInput.value = func;
  }
  gameRefreshFunction(): void {
    const gd = this.gameData;
    let localHuman = false;
    let stored = "";
    if (gd.currentTurn >= 0 && gd.currentTurn < gd.players.length) {
      const player = gd.players[gd.currentTurn];
      localHuman = player.localPlayer && !(player instanceof ComputerPlayer);
      stored = player.getCurrentTurnSoldier().function_;
    }
    this.functionInput.disabled = !localHuman;
    this.fireButton.disabled = !localHuman;
    this.functionInput.value = localHuman ? stored : "";
  }
  gameRefreshSoldiers(): void {
    this.refreshPreGamePlayers();
  }
  gameRefreshBack(): void {
    this.plane.setTerrain(this.gameData.obstacle!);
  }
  gameRepaintAngle(): void {}
  gameStopPanel(): void {}
  gameShowMessage(msg: string): void {
    this.gameMsgText.textContent = msg;
    this.gameMsgPanel.style.display = "block";
  }
  gameSetNextMarker(on: boolean): void {
    this.plane.setNextMarker(on);
  }
  enterGameScreen(): void {
    this.setScreen(Constants.GAME_SCREEN);
  }
  enterPregameScreen(): void {
    this.setScreen(Constants.PRE_GAME_SCREEN);
  }

  globalRefreshGameButton(): void {}
  globalRefreshPlayers(): void {
    this.globalPlayersEl.innerHTML = "";
    const myName = this.globalClient.localPlayer;
    for (const p of this.globalClient.players) {
      const row = document.createElement("div");
      row.className = "row player-online";
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.textContent = "●";
      const name = document.createElement("span");
      name.className = "row-text";
      name.textContent = p.name === myName ? `${p.name} (You)` : p.name;
      row.append(dot, name);
      this.globalPlayersEl.appendChild(row);
    }
  }
  globalRefreshRooms(): void {
    this.globalRoomsEl.innerHTML = "";
    const search = (this.globalRoomSearchField?.value ?? "").toLowerCase();
    const modeIdx = this.globalRoomModeFilter?.selectedIndex ?? 0;
    const statusIdx = this.globalRoomStatusFilter?.selectedIndex ?? 0;
    const modeFilterMap = [-1, 0, 1, 2]; // All=any, Normal=0, FST ODE=1, SND ODE=2
    const filteredMode = modeFilterMap[modeIdx];

    let hasRooms = false;
    for (const r of this.globalClient.rooms) {
      /* apply filters */
      if (search.length > 0 && !r.name.toLowerCase().includes(search)) continue;
      if (filteredMode !== -1 && r.mode !== filteredMode) continue;
      if (statusIdx === 1 && r.private) continue; // Public only
      if (statusIdx === 2 && !r.private) continue; // Private only

      hasRooms = true;
      const row = document.createElement("div");
      row.className = "row cols";
      row.dataset.roomId = String(r.roomID);

      const name = document.createElement("span");
      name.className = "room-name";
      name.textContent = r.name;

      const mode = document.createElement("span");
      mode.className = "col-mode";
      mode.textContent = MODE_NAMES[r.mode] ?? "Normal";

      const np = Number.isFinite(r.numPlayers) ? r.numPlayers : 0;
      const players = document.createElement("span");
      players.className = "col-players";
      players.textContent = `${np}/${Constants.MAX_PLAYERS}`;

      const status = document.createElement("span");
      status.className = `col-status status ${r.private ? "private" : "public"}`;
      status.textContent = r.private ? "Private" : "Public";

      const action = document.createElement("span");
      action.className = "col-action";
      const joinBtn = document.createElement("button");
      joinBtn.className = "join-btn";
      joinBtn.textContent = "Join";
      action.appendChild(joinBtn);

      row.append(name, mode, players, status, action);
      this.globalRoomsEl.appendChild(row);
    }

    if (!hasRooms) {
      const empty = document.createElement("div");
      empty.className = "rooms-empty";
      empty.textContent = this.globalClient.rooms.length === 0
        ? "No rooms available. Create one!"
        : "No rooms match your filters.";
      this.globalRoomsEl.appendChild(empty);
    }
  }
  private triggerJoin(r: { name: string; roomID: number; port: number; private: boolean }): void {
    if (this.onJoinRoom !== null) {
      this.onJoinRoom({ name: r.name, roomID: r.roomID, port: r.port, private: r.private });
    }
  }
  globalShowDisconnectMessage(msg: string): void {
    this.showGlobalMessage(msg);
  }
  chatGlobal(playerName: string, message: string): void {
    const line = document.createElement("div");
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = `${playerName}: `;
    line.appendChild(name);
    line.appendChild(document.createTextNode(message));
    this.globalChatEl.appendChild(line);
    this.globalChatEl.scrollTop = this.globalChatEl.scrollHeight;
  }
  public showGlobalMessage(msg: string): void {
    this.globalMsgText.textContent = msg;
    this.globalMsgPanel.style.display = "flex";
  }
}