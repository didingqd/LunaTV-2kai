/**
 * ArtPlayer 快进/快退按钮插件
 * 桌面端（>=768px）：在控制栏添加按钮
 * 移动端（<768px）：在播放器左右两侧添加悬浮按钮
 */

export default function artplayerPluginSeekButtons(option = {}) {
  return (art) => {
    let currentSeekTime = option.seekTime || 10;
    let currentMobileLayout = option.mobileLayout || 'both';

    const { seekTime = 10, mobileLayout = 'both' } = option;

    // 初始化当前值
    currentSeekTime = seekTime;
    currentMobileLayout = mobileLayout;

    // 检测屏幕宽度
    const isSmallScreen = () => window.innerWidth < 768;

    // 修改点：照抄 APP 端 PIP 快退/快进图标（PipActionsPlugin.buildSeekIcon）的画法，
    // 由 108 设计稿坐标换算到 32 视图（×32/108）：
    // - 320° 圆弧（线宽 2.96、圆头端点），弧末端收在「右中」（3 点钟位置）；
    // - 箭头画在弧末端、指向该处切线方向（竖直向下）；
    // - 快进（顺时针）箭头在右侧正中；快退为快进的水平镜像（逆时针），箭头落在
    //   左侧正中（9 点钟位置），同样竖直向下。
    const backwardIconSvg = `
        <path d="M 6.24 24.19 A 12.74 12.74 0 1 0 3.26 16" fill="none" stroke="currentColor" stroke-width="2.96" stroke-linecap="round"/>
        <path d="M 3.26 19.85 L 0 13.04 L 6.52 13.04 Z" fill="currentColor"/>
      `;
    const forwardIconSvg = `
        <path d="M 25.76 24.19 A 12.74 12.74 0 1 1 28.74 16" fill="none" stroke="currentColor" stroke-width="2.96" stroke-linecap="round"/>
        <path d="M 28.74 19.85 L 32 13.04 L 25.48 13.04 Z" fill="currentColor"/>
      `;

    // 生成图标的函数（修改点：注入整段 SVG 图形，圆弧用 stroke、箭头用 fill）
    const generateSeekIcon = (iconSvg, time) => `
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: 100%;">
        ${iconSvg}
        <text x="16" y="19" text-anchor="middle" font-size="9" font-weight="bold" fill="currentColor" font-family="Arial, sans-serif">${time}</text>
      </svg>
    `;

    // 修改点：引用照抄 APP 端的 SVG 图形片段（原为单个 path d 字符串）
    const generateBackwardIcon = (time) =>
      generateSeekIcon(backwardIconSvg, time);

    const generateForwardIcon = (time) =>
      generateSeekIcon(forwardIconSvg, time);

    const generateDualSeekIcon = (time) => `
      <svg viewBox="0 0 32 56" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: 100%;">
        <!-- 上方后退箭头 -->
        <g transform="translate(0, 2) scale(0.65)">
          ${backwardIconSvg}
          <text x="16" y="19" text-anchor="middle" font-size="9" font-weight="bold" fill="currentColor" font-family="Arial, sans-serif">${time}</text>
        </g>
        <!-- 下方前进箭头 -->
        <g transform="translate(0, 30) scale(0.65)">
          ${forwardIconSvg}
          <text x="16" y="19" text-anchor="middle" font-size="9" font-weight="bold" fill="currentColor" font-family="Arial, sans-serif">${time}</text>
        </g>
      </svg>
    `;

    // SVG 图标 - 后退（修改点：逆时针圆弧，箭头在左侧中间朝下 + 数字）
    const backwardIcon = generateBackwardIcon(currentSeekTime);

    // SVG 图标 - 前进（修改点：顺时针圆弧，箭头在右侧中间朝下 + 数字）
    const forwardIcon = generateForwardIcon(currentSeekTime);

    // 快进/快退功能
    const seekBackward = () => {
      const newTime = Math.max(0, art.currentTime - currentSeekTime);
      art.seek = newTime;
      art.notice.show = `⏪ 后退 ${currentSeekTime} 秒`;
    };

    const seekForward = () => {
      const newTime = Math.min(art.duration, art.currentTime + currentSeekTime);
      art.seek = newTime;
      art.notice.show = `⏩ 前进 ${currentSeekTime} 秒`;
    };

    // 根据屏幕大小选择不同的实现方式
    if (isSmallScreen()) {
      // 小屏幕：创建悬浮按钮
      const createFloatingButton = (side, isSingleButton = false) => {
        const button = document.createElement('div');
        button.className = `art-seek-floating-${side}`;

        if (isSingleButton) {
          // 单侧模式：显示双向箭头（竖向排列）
          button.innerHTML = generateDualSeekIcon(currentSeekTime);

          // 点击事件：上半边快退，下半边快进
          button.onclick = (e) => {
            const rect = button.getBoundingClientRect();
            const clickY = e.clientY - rect.top;
            const isTopHalf = clickY < rect.height / 2;
            if (isTopHalf) {
              seekBackward();
            } else {
              seekForward();
            }
          };
        } else {
          // 双侧模式：显示单向箭头
          const icon =
            side === 'left'
              ? generateBackwardIcon(currentSeekTime)
              : generateForwardIcon(currentSeekTime);
          button.innerHTML = icon;
          button.onclick = side === 'left' ? seekBackward : seekForward;
        }

        return button;
      };

      art.on('ready', () => {
        const buttons = [];

        // 根据 mobileLayout 创建按钮
        if (currentMobileLayout === 'both') {
          // 双侧模式：左边快退，右边快进（单向箭头）
          const leftButton = createFloatingButton('left', false);
          const rightButton = createFloatingButton('right', false);
          art.template.$player.appendChild(leftButton);
          art.template.$player.appendChild(rightButton);
          buttons.push(leftButton, rightButton);
        } else {
          // 单侧模式：一个按钮显示双向箭头
          const button = createFloatingButton(currentMobileLayout, true);
          art.template.$player.appendChild(button);
          buttons.push(button);
        }

        // 跟随控制栏的显示/隐藏状态（锁定时也隐藏）
        const updateButtonsVisibility = () => {
          const controlsVisible = art.controls.show && !art.isLock;
          const allButtons = art.template.$player.querySelectorAll(
            '.art-seek-floating-left, .art-seek-floating-right',
          );
          allButtons.forEach((button) => {
            if (controlsVisible) {
              button.style.opacity = '0.85';
              button.style.pointerEvents = 'auto';
            } else {
              button.style.opacity = '0';
              button.style.pointerEvents = 'none';
            }
          });
        };

        // 监听控制栏显示/隐藏事件，以及锁定/解锁事件
        art.on('control', updateButtonsVisibility);
        art.on('lock', updateButtonsVisibility);

        // 初始状态
        updateButtonsVisibility();
      });

      // 添加悬浮按钮样式
      const style = document.createElement('style');
      style.textContent = `
        .art-seek-floating-left,
        .art-seek-floating-right {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          background: rgba(255, 255, 255, 0.15);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.2);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          z-index: 20;
          opacity: 0;
          transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s ease;
          color: white;
          padding: 14px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
          pointer-events: none;
        }

        /* 双侧模式：圆形按钮（单向箭头） */
        body:not([data-seek-layout="left"]):not([data-seek-layout="right"]) .art-seek-floating-left,
        body:not([data-seek-layout="left"]):not([data-seek-layout="right"]) .art-seek-floating-right {
          width: 64px;
          height: 64px;
          border-radius: 50%;
        }

        /* 单侧模式：竖向椭圆按钮（双向箭头上下排列） */
        body[data-seek-layout="left"] .art-seek-floating-left,
        body[data-seek-layout="right"] .art-seek-floating-right {
          width: 64px;
          height: 110px;
          border-radius: 32px;
        }

        /* 双侧模式：按钮分别位于播放器左右两侧中间（修改点：原为屏幕居中 Netflix 风格） */
        body:not([data-seek-layout="left"]):not([data-seek-layout="right"]) .art-seek-floating-left {
          left: 16px;
        }

        body:not([data-seek-layout="left"]):not([data-seek-layout="right"]) .art-seek-floating-right {
          right: 16px;
        }

        /* 双侧模式 active 状态：保持垂直居中缩放 */
        body:not([data-seek-layout="left"]):not([data-seek-layout="right"]) .art-seek-floating-left:active,
        body:not([data-seek-layout="left"]):not([data-seek-layout="right"]) .art-seek-floating-right:active {
          transform: translateY(-50%) scale(0.92);
        }

        /* 单侧模式：按钮在屏幕边缘 */
        body[data-seek-layout="left"] .art-seek-floating-left {
          left: 16px;
          top: 35%;  /* 向上移动避开锁定按钮 */
        }

        body[data-seek-layout="right"] .art-seek-floating-right {
          right: 16px;
        }

        /* 单侧模式的active状态 */
        body[data-seek-layout="left"] .art-seek-floating-left:active,
        body[data-seek-layout="right"] .art-seek-floating-right:active {
          transform: translateY(-50%) scale(0.92);
          background: rgba(255, 255, 255, 0.25);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        }

        /* 全屏时调整位置和大小 */
        /* 双侧模式全屏：保持左右两侧位置，稍微增大与边缘的距离（修改点：原为居中模式调整间距） */
        .art-fullscreen body:not([data-seek-layout="left"]):not([data-seek-layout="right"]) .art-seek-floating-left,
        .art-fullscreen-web body:not([data-seek-layout="left"]):not([data-seek-layout="right"]) .art-seek-floating-left {
          left: 24px;
        }

        .art-fullscreen body:not([data-seek-layout="left"]):not([data-seek-layout="right"]) .art-seek-floating-right,
        .art-fullscreen-web body:not([data-seek-layout="left"]):not([data-seek-layout="right"]) .art-seek-floating-right {
          right: 24px;
        }

        /* 单侧模式全屏：调整边缘位置 */
        .art-fullscreen body[data-seek-layout="left"] .art-seek-floating-left,
        .art-fullscreen-web body[data-seek-layout="left"] .art-seek-floating-left {
          left: 24px;
          top: 35%;
        }

        .art-fullscreen body[data-seek-layout="right"] .art-seek-floating-right,
        .art-fullscreen-web body[data-seek-layout="right"] .art-seek-floating-right {
          right: 24px;
        }

        /* 全屏时：双侧模式 */
        .art-fullscreen body:not([data-seek-layout="left"]):not([data-seek-layout="right"]) .art-seek-floating-left,
        .art-fullscreen body:not([data-seek-layout="left"]):not([data-seek-layout="right"]) .art-seek-floating-right,
        .art-fullscreen-web body:not([data-seek-layout="left"]):not([data-seek-layout="right"]) .art-seek-floating-left,
        .art-fullscreen-web body:not([data-seek-layout="left"]):not([data-seek-layout="right"]) .art-seek-floating-right {
          width: 72px;
          height: 72px;
          padding: 16px;
        }

        /* 全屏时：单侧模式 */
        .art-fullscreen body[data-seek-layout="left"] .art-seek-floating-left,
        .art-fullscreen body[data-seek-layout="right"] .art-seek-floating-right,
        .art-fullscreen-web body[data-seek-layout="left"] .art-seek-floating-left,
        .art-fullscreen-web body[data-seek-layout="right"] .art-seek-floating-right {
          width: 72px;
          height: 128px;
          padding: 16px;
        }
      `;
      document.head.appendChild(style);

      // 设置 body 的 data-seek-layout 属性
      document.body.setAttribute('data-seek-layout', currentMobileLayout);
    } else {
      // 大屏幕：添加到控制栏
      art.controls.add({
        name: 'seek-backward',
        position: 'left',
        html: backwardIcon,
        tooltip: `后退 ${seekTime} 秒`,
        style: {
          width: '40px',
          height: '40px',
          padding: '8px',
          opacity: '0.9',
          transition: 'all 0.2s ease',
        },
        mounted: ($el) => {
          $el.addEventListener('mouseenter', () => {
            $el.style.opacity = '1';
            $el.style.transform = 'scale(1.1)';
          });
          $el.addEventListener('mouseleave', () => {
            $el.style.opacity = '0.9';
            $el.style.transform = 'scale(1)';
          });
        },
        click: seekBackward,
      });

      art.controls.add({
        name: 'seek-forward',
        position: 'left',
        html: forwardIcon,
        tooltip: `前进 ${seekTime} 秒`,
        style: {
          width: '40px',
          height: '40px',
          padding: '8px',
          opacity: '0.9',
          transition: 'all 0.2s ease',
        },
        mounted: ($el) => {
          $el.addEventListener('mouseenter', () => {
            $el.style.opacity = '1';
            $el.style.transform = 'scale(1.1)';
          });
          $el.addEventListener('mouseleave', () => {
            $el.style.opacity = '0.9';
            $el.style.transform = 'scale(1)';
          });
        },
        click: seekForward,
      });
    }

    return {
      name: 'artplayerPluginSeekButtons',
      config: (newOptions) => {
        // 修改点：移除未使用的 oldSeekTime（pre-commit 严格 lint 警告）
        const oldMobileLayout = currentMobileLayout;

        // 更新配置
        if (newOptions.seekTime !== undefined) {
          currentSeekTime = newOptions.seekTime;
        }
        if (newOptions.mobileLayout !== undefined) {
          currentMobileLayout = newOptions.mobileLayout;
        }

        // 更新桌面端按钮
        if (!isSmallScreen()) {
          const backwardBtn = art.controls['seek-backward'];
          const forwardBtn = art.controls['seek-forward'];
          if (backwardBtn && forwardBtn) {
            backwardBtn.innerHTML = generateBackwardIcon(currentSeekTime);
            forwardBtn.innerHTML = generateForwardIcon(currentSeekTime);
            // 更新 tooltip（需要更新 DOM 属性）
            backwardBtn.setAttribute(
              'aria-label',
              `后退 ${currentSeekTime} 秒`,
            );
            forwardBtn.setAttribute('aria-label', `前进 ${currentSeekTime} 秒`);
          }
        } else {
          // 移动端：检查是否需要重建按钮
          const layoutChanged =
            newOptions.mobileLayout !== undefined &&
            oldMobileLayout !== currentMobileLayout;

          if (layoutChanged) {
            // 布局改变：需要重建按钮（数量和位置会变）
            const oldButtons = art.template.$player.querySelectorAll(
              '.art-seek-floating-left, .art-seek-floating-right',
            );
            oldButtons.forEach((btn) => btn.remove());

            // 更新 body 属性
            document.body.setAttribute('data-seek-layout', currentMobileLayout);

            const createFloatingButtonForUpdate = (side, isSingleButton) => {
              const button = document.createElement('div');
              button.className = `art-seek-floating-${side}`;

              if (isSingleButton) {
                // 单侧模式：显示双向箭头（竖向排列）
                button.innerHTML = generateDualSeekIcon(currentSeekTime);
                button.onclick = (e) => {
                  const rect = button.getBoundingClientRect();
                  const clickY = e.clientY - rect.top;
                  const isTopHalf = clickY < rect.height / 2;
                  if (isTopHalf) {
                    seekBackward();
                  } else {
                    seekForward();
                  }
                };
              } else {
                // 双侧模式：显示单向箭头
                const icon =
                  side === 'left'
                    ? generateBackwardIcon(currentSeekTime)
                    : generateForwardIcon(currentSeekTime);
                button.innerHTML = icon;
                button.onclick = side === 'left' ? seekBackward : seekForward;
              }
              return button;
            };

            if (currentMobileLayout === 'both') {
              const leftButton = createFloatingButtonForUpdate('left', false);
              const rightButton = createFloatingButtonForUpdate('right', false);
              art.template.$player.appendChild(leftButton);
              art.template.$player.appendChild(rightButton);
            } else {
              const button = createFloatingButtonForUpdate(
                currentMobileLayout,
                true,
              );
              art.template.$player.appendChild(button);
            }

            // 重建后立即更新按钮可见性
            const controlsVisible = art.controls.show;
            const newButtons = art.template.$player.querySelectorAll(
              '.art-seek-floating-left, .art-seek-floating-right',
            );
            newButtons.forEach((btn) => {
              if (controlsVisible) {
                btn.style.opacity = '0.85';
                btn.style.pointerEvents = 'auto';
              } else {
                btn.style.opacity = '0';
                btn.style.pointerEvents = 'none';
              }
            });
          } else if (newOptions.seekTime !== undefined) {
            // 只是秒数改变：只更新 innerHTML，不重建按钮
            const buttons = art.template.$player.querySelectorAll(
              '.art-seek-floating-left, .art-seek-floating-right',
            );

            if (currentMobileLayout === 'both') {
              // 双侧模式：更新单向箭头
              buttons.forEach((button) => {
                if (button.classList.contains('art-seek-floating-left')) {
                  button.innerHTML = generateBackwardIcon(currentSeekTime);
                } else {
                  button.innerHTML = generateForwardIcon(currentSeekTime);
                }
              });
            } else {
              // 单侧模式：更新双向箭头（竖向排列）
              buttons.forEach((button) => {
                button.innerHTML = generateDualSeekIcon(currentSeekTime);
              });
            }
          }
        }
      },
    };
  };
}
