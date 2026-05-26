import React from 'react';
import styled from 'styled-components';

const Card = () => {
  return (
    <StyledWrapper>
      <div className="luminous-card-container">
        <input type="checkbox" className="luminous-toggle-input" id="luminousToggle" />
        <label htmlFor="luminousToggle" className="luminous-card">
          <div className="luminous-light-layer">
            <div className="luminous-slit" />
            <div className="luminous-lumen">
              <div className="min" />
              <div className="mid" />
              <div className="hi" />
            </div>
            <div className="luminous-darken">
              <div className="sl" />
              <div className="ll" />
              <div className="slt" />
              <div className="srt" />
            </div>
          </div>
          <div className="luminous-content">
            <div className="luminous-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="3.2rem" height="3.2rem" viewBox="0 0 1024 1024">
                <path fill="url(#iconGradient)" d="M488.1 414.7V303.4L300.9 428l83.6 55.8zm254.1 137.7v-79.8l-59.8 39.9zM512 64C264.6 64 64 264.6 64 512s200.6 448 448 448s448-200.6 448-448S759.4 64 512 64m278 533c0 1.1-.1 2.1-.2 3.1c0 .4-.1.7-.2 1a14.2 14.2 0 0 1-.8 3.2c-.2.6-.4 1.2-.6 1.7c-.2.4-.4.8-.5 1.2c-.3.5-.5 1.1-.8 1.6c-.2.4-.4.7-.7 1.1c-.3.5-.7 1-1 1.5c-.3.4-.5.7-.8 1c-.4.4-.8.9-1.2 1.3c-.3.3-.6.6-1 .9c-.4.4-.9.8-1.4 1.1c-.4.3-.7.6-1.1.8c-.1.1-.3.2-.4.3L525.2 786c-4 2.7-8.6 4-13.2 4c-4.7 0-9.3-1.4-13.3-4L244.6 616.9c-.1-.1-.3-.2-.4-.3l-1.1-.8c-.5-.4-.9-.7-1.3-1.1c-.3-.3-.6-.6-1-.9c-.4-.4-.8-.8-1.2-1.3a7 7 0 0 1-.8-1c-.4-.5-.7-1-1-1.5c-.2-.4-.5-.7-.7-1.1c-.3-.5-.6-1.1-.8-1.6c-.2-.4-.4-.8-.5-1.2c-.2-.6-.4-1.2-.6-1.7c-.1-.4-.3-.8-.4-1.2c-.2-.7-.3-1.3-.4-2c-.1-.3-.1-.7-.2-1c-.1-1-.2-2.1-.2-3.1V427.9c0-1 .1-2.1.2-3.1c.1-.3.1-.7.2-1a14.2 14.2 0 0 1 .8-3.2c.2-.6.4-1.2.6-1.7c.2-.4.4-.8.5-1.2c.2-.5.5-1.1.8-1.6c.2-.4.4-.7.7-1.1c.6-.9 1.2-1.7 1.8-2.5c.4-.4.8-.9 1.2-1.3c.3-.3.6-.6 1-.9c.4-.4.9-.8 1.3-1.1s.7-.6 1.1-.8c.1-.1.3-.2.4-.3L498.7 239c8-5.3 18.5-5.3 26.5 0l254.1 169.1c.1.1.3.2.4.3l1.1.8l1.4 1.1c.3.3.6.6 1 .9c.4.4.8.8 1.2 1.3c.7.8 1.3 1.6 1.8 2.5c.2.4.5.7.7 1.1c.3.5.6 1 .8 1.6c.2.4.4.8.5 1.2c.2.6.4 1.2.6 1.7c.1.4.3.8.4 1.2c.2.7.3 1.3.4 2c.1.3.1.7.2 1c.1 1 .2 2.1.2 3.1zm-254.1 13.3v111.3L723.1 597l-83.6-55.8zM281.8 472.6v79.8l59.8-39.9zM512 456.1l-84.5 56.4l84.5 56.4l84.5-56.4zM723.1 428L535.9 303.4v111.3l103.6 69.1zM384.5 541.2L300.9 597l187.2 124.6V610.3z" filter="url(#strong-inner)" />
                <defs>
                  <linearGradient id="iconGradient" x1={0} x2={0} y1={-1} y2="0.8">
                    <stop offset="0%" stopColor="#bbb" />
                    <stop offset="100%" stopColor="#555" />
                  </linearGradient>
                  <filter id="strong-inner">
                    <feFlood floodColor="#fff2" />
                    <feComposite operator="out" in2="SourceGraphic" />
                    <feMorphology operator="dilate" radius={8} />
                    <feGaussianBlur stdDeviation={32} />
                    <feComposite operator="atop" in2="SourceGraphic" />
                  </filter>
                </defs>
              </svg>
            </div>
            <div className="luminous-bottom">
              <div className="luminous-title">Luminous Design</div>
              <p className="luminous-description">
                Light Folds Around Form <br />Revealing Layers Of Depth
              </p>
              <div className="luminous-toggle">
                <div className="luminous-handle" />
                <span className="luminous-toggle-label">Activate Lumen</span>
              </div>
            </div>
          </div>
        </label>
      </div>
    </StyledWrapper>
  );
}

const StyledWrapper = styled.div`
  .luminous-card-container {
    box-sizing: border-box;
    scroll-behavior: smooth;
    margin: 0;
    padding: 0;
    --sz: clamp(17px, min(2%, 3%), 24px);
    font-size: var(--sz);
    display: grid;
    place-items: center;
    background: #1e1e1e;
    background: radial-gradient(circle at 50% 30%, #2a2a2a 0%, #131313 64%);
    font-family: "Aeonik Pro Regular", sans-serif;
    min-height: 100%;
    overflow: hidden;
    min-width: 100%;
  }

  .luminous-card-container * {
    box-sizing: border-box;
  }

  .luminous-card {
    position: relative;
    background: radial-gradient(circle at 50% 0%, #3a3a3a 0%, #1a1a1a 64%);
    box-shadow:
      inset 0 1.01rem 0.2rem -1rem #fff0,
      inset 0 -1.01rem 0.2rem -1rem #0000,
      0 -1.02rem 0.2rem -1rem #fff0,
      0 1rem 0.2rem -1rem #0000,
      0 0 0 1px #fff3,
      0 4px 4px 0 #0004,
      0 0 0 1px #333;
    width: 18rem;
    height: 24rem;
    border-radius: 1.8rem;
    color: #fff;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    justify-content: end;
    transition:
      all 0.4s ease-in-out,
      translate 0.4s ease-out;
  }

  .luminous-card::before {
    content: "";
    display: block;
    --offset: 1rem;
    width: calc(100% + 2 * var(--offset));
    height: calc(100% + 2 * var(--offset));
    position: absolute;
    left: calc(-1 * var(--offset));
    right: calc(-1 * var(--offset));
    top: calc(-1 * var(--offset));
    bottom: calc(-1 * var(--offset));
    margin: auto;
    box-shadow: inset 0 0 0px 0.06rem #fff2;
    border-radius: 2.6rem;
    --ax: 4rem;
    clip-path: polygon(
      var(--ax) 0,
      0 0,
      0 var(--ax),
      var(--ax) var(--ax),
      var(--ax) calc(100% - var(--ax)),
      0 calc(100% - var(--ax)),
      0 100%,
      var(--ax) 100%,
      var(--ax) calc(100% - var(--ax)),
      calc(100% - var(--ax)) calc(100% - var(--ax)),
      calc(100% - var(--ax)) 100%,
      100% 100%,
      100% calc(100% - var(--ax)),
      calc(100% - var(--ax)) calc(100% - var(--ax)),
      calc(100% - var(--ax)) var(--ax),
      100% var(--ax),
      100% 0,
      calc(100% - var(--ax)) 0,
      calc(100% - var(--ax)) var(--ax),
      var(--ax) var(--ax)
    );
    transition: all 0.4s ease-in-out;
  }

  .luminous-card:hover {
    translate: 0 -0.2rem;
  }

  .luminous-card:hover::before {
    --offset: 0.5rem;
    --ax: 8rem;
    border-radius: 2.2rem;
    box-shadow: inset 0 0 0 0.08rem #fff1;
  }

  .luminous-light-layer {
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    width: 100%;
    transform-style: preserve-3d;
    perspective: 400px;
    pointer-events: none;
  }

  .luminous-slit {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    margin: auto;
    width: 64%;
    height: 1.2rem;
    transform: rotateX(-76deg);
    background: #121212;
    box-shadow: 0 0 4px 0 #fff0;
    transition: all 0.4s ease-in-out;
  }

  .luminous-lumen {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    margin: auto;
    width: 100%;
    height: 100%;
    pointer-events: none;
    perspective: 400px;
    opacity: 0;
    transition: opacity 0.4s ease-in-out;
  }

  .luminous-lumen .min {
    width: 70%;
    height: 3rem;
    background: linear-gradient(#fff0, #fffa);
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    bottom: 2.5rem;
    margin: auto;
    transform: rotateX(-42deg);
    opacity: 0.4;
  }

  .luminous-lumen .mid {
    width: 74%;
    height: 13rem;
    background: linear-gradient(#fff0, #fffa);
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    bottom: 10em;
    margin: auto;
    transform: rotateX(-42deg);
    filter: blur(1rem);
    opacity: 0.8;
    border-radius: 100% 100% 0 0;
  }

  .luminous-lumen .hi {
    width: 50%;
    height: 13rem;
    background: linear-gradient(#fff0, #fffa);
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    bottom: 12em;
    margin: auto;
    transform: rotateX(22deg);
    filter: blur(1rem);
    opacity: 0.6;
    border-radius: 100% 100% 0 0;
  }

  .luminous-darken {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    margin: auto;
    width: 100%;
    height: 100%;
    pointer-events: none;
    perspective: 400px;
    transition: opacity 0.4s ease-in-out;
    opacity: 0.5;
  }

  .luminous-darken > * {
    transition: opacity 0.4s ease-in-out;
  }

  .luminous-darken .sl {
    width: 64%;
    height: 10rem;
    background: linear-gradient(#000, #0000);
    position: absolute;
    left: 0;
    right: 0;
    top: 9.6em;
    bottom: 0;
    margin: auto;
    filter: blur(0.2rem);
    opacity: 0.1;
    border-radius: 0 0 100% 100%;
    transform: rotateX(-22deg);
  }

  .luminous-darken .ll {
    width: 62%;
    height: 10rem;
    background: linear-gradient(#000a, #0000);
    position: absolute;
    left: 0;
    right: 0;
    top: 11em;
    bottom: 0;
    margin: auto;
    filter: blur(0.8rem);
    opacity: 0.4;
    border-radius: 0 0 100% 100%;
    transform: rotateX(22deg);
  }

  .luminous-darken .slt {
    width: 0.5rem;
    height: 4rem;
    background: linear-gradient(#0005, #0000);
    position: absolute;
    left: 0;
    right: 11.5rem;
    top: 3.9em;
    bottom: 0;
    margin: auto;
    opacity: 0.6;
    border-radius: 0 0 100% 100%;
    transform: skewY(42deg);
  }

  .luminous-darken .srt {
    width: 0.5rem;
    height: 4rem;
    background: linear-gradient(#0005, #0000);
    position: absolute;
    right: 0;
    left: 11.5rem;
    top: 3.9em;
    bottom: 0;
    margin: auto;
    opacity: 0.6;
    border-radius: 0 0 100% 100%;
    transform: skewY(-42deg);
  }

  .luminous-content {
    position: relative;
    z-index: 1;
  }

  .luminous-icon {
    position: absolute;
    top: -13rem;
    left: 0;
    right: 0;
    margin: auto;
    width: fit-content;
    filter: drop-shadow(0 -1.2rem 1px transparent);
    transition: filter 0.4s ease-in-out;
  }

  .luminous-bottom {
    position: relative;
  }

  .luminous-title {
    margin: 0;
    margin-bottom: 1rem;
    font-size: 1.2rem;
    color: #fff;
    font-weight: normal;
  }

  .luminous-description {
    margin: 0;
    padding-bottom: 0.6rem;
    color: #aaa;
    font-size: 0.6rem;
    font-weight: 100;
    border-bottom: 1px solid #fff1;
    max-width: 64%;
  }

  .luminous-toggle-input {
    display: none;
  }

  .luminous-toggle {
    position: absolute;
    right: 0;
    bottom: 0;
    height: 2rem;
    width: 4.8rem;
    border-radius: 0.6rem;
    background: #000;
    box-shadow:
      inset 0 -8px 8px 0.3rem #0004,
      inset 0 0 1px 0.3rem #ddd,
      inset 0 -2px 1px 0.3rem #fff,
      inset 0 1px 2px 0.3rem #0006,
      inset 0 0 1px 0.8rem #aaa;
    cursor: pointer;
    transition: all 0.4s ease-in-out;
  }

  .luminous-toggle::before {
    content: "";
    display: block;
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    margin: auto;
    width: 3.4rem;
    height: 0.68rem;
    border-radius: 0.2rem;
    background: #000;
    transition: all 0.4s ease-in-out;
  }

  .luminous-handle {
    position: absolute;
    top: 0;
    bottom: 0.04rem;
    margin: auto;
    left: 0.68rem;
    width: 40%;
    height: 30%;
    background: #aaa;
    border-radius: 0.2rem;
    box-shadow:
      inset 0 1px 4px 0 #fff,
      inset 0 -1px 1px 0 #000a,
      0 0 1px 1px #0003,
      1px 3px 6px 1px #000a;
    transition: all 0.4s ease-in-out;
    pointer-events: none;
  }

  .luminous-toggle-input:checked
    ~ .luminous-content
    .luminous-toggle
    .luminous-handle {
    transform: translateX(1.58rem);
  }

  .luminous-toggle-label {
    pointer-events: none;
    text-align: center;
    position: absolute;
    left: 0;
    right: 0;
    margin: auto;
    bottom: calc(100% + 0.4rem);
    font-size: 0.6rem;
    font-weight: 100;
    color: #999;
    opacity: 0;
    transition: opacity 0.4s ease-in-out;
  }

  .luminous-toggle:hover .luminous-toggle-label {
    opacity: 1;
  }

  .luminous-toggle:not(
      .luminous-toggle-input:checked ~ .luminous-content .luminous-toggle
    ):hover
    .luminous-handle {
    transform: translateX(0.2rem);
  }

  .luminous-toggle-input:checked ~ .luminous-card {
    box-shadow:
      inset 0 1.01rem 0.1rem -1rem #fffa,
      inset 0 -4rem 3rem -3rem #000a,
      0 -1.02rem 0.2rem -1rem #fffa,
      0 1rem 0.2rem -1rem #000,
      0 0 0 1px #fff2,
      0 4px 4px 0 #0004,
      0 0 0 1px #333;
  }

  .luminous-toggle-input:checked ~ .luminous-card .luminous-slit {
    background: #fff;
    box-shadow: 0 0 4px 0 #fff;
  }

  .luminous-toggle-input:checked ~ .luminous-card .luminous-lumen {
    opacity: 0.5;
  }

  .luminous-toggle-input:checked ~ .luminous-card .luminous-darken {
    opacity: 0.8;
  }

  .luminous-toggle-input:checked ~ .luminous-card .luminous-darken .sl {
    opacity: 0.2;
  }

  .luminous-toggle-input:checked ~ .luminous-card .luminous-darken .ll {
    opacity: 1;
  }

  .luminous-toggle-input:checked ~ .luminous-card .luminous-darken .slt {
    opacity: 1;
  }

  .luminous-toggle-input:checked ~ .luminous-card .luminous-darken .srt {
    opacity: 1;
  }

  .luminous-toggle-input:checked ~ .luminous-card .luminous-icon {
    filter: drop-shadow(0 -1.2rem 2px #0003) brightness(1.64);
  }

  .luminous-toggle-input:checked ~ .luminous-card .luminous-toggle::before {
    background: #fffc;
    box-shadow: 0 0 0.3rem 0.2rem #fff7;
  }

  .luminous-toggle-input:checked ~ .luminous-card .luminous-handle {
    box-shadow:
      inset 0 1px 12px 0 #fff,
      inset 0 -1px 1px 0 #fffa,
      0 0 2px 1px #4443,
      1px 3px 6px 1px #0004;
  }`;

export default Card;
