import type { CSSProperties, ReactNode } from "react";
import {
  KioskError,
  KioskFacePlaceholder,
  KioskMessage,
  KioskOvalStage,
  KioskScreen,
  KioskWelcome,
  type KioskOrientation,
} from "@didit-events/ui/kiosk";
import type { ScreenModel } from "./screen";

export interface KioskViewProps {
  model: ScreenModel;
  orientation: KioskOrientation;
  width?: number;
  height?: number;
  /** The live <video>, or `placeholder` for the gallery's stand-in scene and face. */
  camera: "placeholder" | ReactNode;
  mirror?: boolean;
  event?: string;
  clock?: string;
  /** "42 / 120 arrived"; shown only where the model asks for it (K-01). */
  counter?: string;
  /** K-14 door-mode chip; shown on the oval screens. */
  badge?: string;
  overlay?: ReactNode;
  /** The live multi-face door (AR layer): replaces the model's centre content, over the same camera layer. */
  live?: ReactNode;
  framed?: boolean;
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/** One door screen from its model. Server-safe; the live door and the /_frames gallery both use it. */
export function KioskView({ model, orientation, width, height, camera, mirror, event, clock, counter, badge, overlay, live, framed, label, className, style }: KioskViewProps) {
  const placeholder = camera === "placeholder";
  return (
    <KioskScreen
      orientation={orientation}
      width={width}
      height={height}
      camera={model.camera === "none" && placeholder ? "none" : camera}
      cameraHidden={model.camera === "none"}
      cameraTone={model.cameraTone}
      cameraDark={model.cameraDark}
      mirror={mirror}
      bloom={model.kind === "welcome" && model.hero}
      event={event}
      clock={clock}
      badge={model.kind === "oval" ? badge : undefined}
      counter={model.kind === "oval" && model.counter ? counter : undefined}
      overlay={overlay}
      framed={framed}
      label={label}
      className={className}
      style={style}
    >
      {live ? live : model.kind === "oval" ? (
        <KioskOvalStage
          head={model.head}
          accent={model.accent}
          tone={model.tone}
          breathing={model.breathing}
          scan={model.scan}
          ring={model.ring}
          hint={model.hint}
          sub={model.sub}
          inside={
            placeholder && model.pose ? (
              <KioskFacePlaceholder orientation={orientation} pose={model.pose} frozen={model.frozen} second={model.second} />
            ) : null
          }
        />
      ) : model.kind === "message" ? (
        <KioskMessage icon={model.icon} iconTone={model.iconTone} iconLabel={model.iconLabel} head={model.head} sub={model.sub} chip={model.chip}>
          {model.error ? <KioskError>{model.error}</KioskError> : null}
        </KioskMessage>
      ) : (
        <KioskWelcome hero={model.hero} greeting={model.greeting} name={model.name} sub={model.sub} time={model.time} />
      )}
    </KioskScreen>
  );
}
