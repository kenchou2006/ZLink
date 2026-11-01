import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/theme.service';
import { I18nService } from './core/i18n.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  private theme = inject(ThemeService);
  private i18n = inject(I18nService);

  ngOnInit(): void {
    this.theme.apply();
    this.i18n.init();
  }
}
