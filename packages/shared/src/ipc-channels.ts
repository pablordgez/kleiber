export const IPC_CHANNELS = {
  projects: {
    list: "projects:list",
    create: "projects:create",
    remove: "projects:remove",
    update: "projects:update",
  },
  sessions: {
    list: "sessions:list",
    create: "sessions:create",
    rename: "sessions:rename",
    send: "sessions:send",
    read: "sessions:read",
    kill: "sessions:kill",
    updated: "sessions:updated",
  },
  settings: {
    get: "settings:get",
    update: "settings:update",
  },
  pack: {
    status: "pack:status",
    install: "pack:install",
    roles: "pack:roles",
  },
  terminals: {
    resize: "terminals:resize",
    output: "terminals:output",
    exit: "terminals:exit",
  },
  shortcuts: {
    newProject: "shortcut:new-project",
    newSession: "shortcut:new-session",
    newSubSession: "shortcut:new-sub-session",
    killSession: "shortcut:kill-session",
    openSettings: "shortcut:open-settings",
  },
} as const;

type ChannelGroup = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
export type IpcChannel = ChannelGroup[keyof ChannelGroup];
