/** Spicetify global type declarations for the extension */

declare namespace Spicetify {
  const React: typeof import("react");
  const ReactDOM: typeof import("react-dom");
  const Platform: {
    History: {
      location: { pathname: string };
      listen: (
        callback: (location: { pathname: string }) => void,
      ) => () => void;
    };
    PlayerAPI: {
      getState: () => {
        item?: {
          uri: string;
          name: string;
          metadata: Record<string, string>;
        };
        timestamp: number;
        positionAsOfTimestamp: number;
        isPaused: boolean;
        duration: number;
      };
      getEvents: () => {
        addListener: (
          event: string,
          callback: (...args: any[]) => void,
        ) => void;
        removeListener: (
          event: string,
          callback: (...args: any[]) => void,
        ) => void;
      };
    };
    Session: {
      accessToken: string;
    };
  };
  const Player: {
    data?: {
      item?: {
        uri: string;
        name: string;
        metadata: Record<string, string>;
        artists?: Array<{ name: string; uri: string }>;
      };
      track?: {
        uri: string;
        name: string;
        metadata: Record<string, string>;
      };
      duration: number;
      positionAsOfTimestamp: number;
      timestamp: number;
      isPaused: boolean;
    };
    seek: (position: number) => void;
    getProgress: () => number;
    getProgressPercent: () => number;
    getDuration: () => number;
    isPlaying: () => boolean;
    addEventListener: (
      event: string,
      callback: (...args: any[]) => void,
    ) => void;
    removeEventListener: (
      event: string,
      callback: (...args: any[]) => void,
    ) => void;
  };
  const CosmosAsync: {
    get: (
      url: string,
      body?: any,
      headers?: Record<string, string>,
    ) => Promise<any>;
    post: (
      url: string,
      body?: any,
      headers?: Record<string, string>,
    ) => Promise<any>;
    put: (
      url: string,
      body?: any,
      headers?: Record<string, string>,
    ) => Promise<any>;
    del: (
      url: string,
      body?: any,
      headers?: Record<string, string>,
    ) => Promise<any>;
    resolve: (method: string, args: any[]) => Promise<any>;
  };
  const URI: {
    from: (uri: string) => { type: string; id: string } | null;
    isTrack: (uri: string) => boolean;
  };
  const showNotification: (
    text: string,
    isError?: boolean,
    msTimeout?: number,
  ) => void;
  const LocalStorage: {
    get: (key: string) => string | null;
    set: (key: string, value: string) => void;
  };
  const Locale: {
    getLocale: () => string;
  };

  /** Playbar API — adds buttons to the bottom now-playing bar (right side) */
  namespace Playbar {
    class Button {
      constructor(
        label: string,
        icon: string | Element,
        onClick?: (self: Button) => void,
        disabled?: boolean,
        active?: boolean,
        registerOnCreate?: boolean,
      );
      label: string;
      icon: string;
      onClick: (self: Button) => void;
      disabled: boolean;
      active: boolean;
      element: HTMLButtonElement;
      tippy: any;
      register: () => void;
      deregister: () => void;
    }
  }

  /** PopupModal API — shows a modal dialog */
  namespace PopupModal {
    function display(config: {
      title: string;
      content: string | Element;
      isLarge?: boolean;
    }): void;
    function hide(): void;
  }

  function getAudioData(uri?: string): Promise<any>;
}
