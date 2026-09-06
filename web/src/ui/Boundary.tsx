// If a screen throws while rendering, show what happened instead of a blank page.
import { Component, type ComponentChildren } from 'preact';

export class Boundary extends Component<{ children: ComponentChildren }, { error: string | null }> {
  override state: { error: string | null } = { error: null };
  static override getDerivedStateFromError(e: unknown) { return { error: (e as Error)?.message ?? String(e) }; }
  override componentDidCatch(e: unknown) { console.error('[tradewarz] render failed', e); }
  override render() {
    if (this.state.error) {
      return (
        <div class="notice bad">
          <p><b>This screen hit an error and stopped drawing.</b></p>
          <p class="small mono">{this.state.error}</p>
          <div class="btnrow"><button class="btn sm" onClick={() => location.reload()}>Reload</button><button class="btn sm" onClick={() => this.setState({ error: null })}>Try again</button></div>
        </div>
      );
    }
    return this.props.children;
  }
}
