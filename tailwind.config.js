/**
 * もとは cdn.tailwindcss.com（ブラウザ内で CSS を組み立てる版）を読み、
 * 設定を <script> で渡していた。その版は本番向けではないうえ、
 * 学校のフィルタリングで塞がれると **画面がまったく出ない**。
 *
 * ここで同じ設定を持ち、使っているクラスだけの CSS を先に作る。
 */
export default {
    content: ['./app-shell.html', './src/**/*.{js,jsx}'],
    theme: {
        extend: {
            animation: {
                'fade-in': 'fadeIn 0.3s ease-out forwards',
                'fade-in-up': 'fadeInUp 0.5s ease-out forwards',
            },
            keyframes: {
                fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
                fadeInUp: {
                    '0%': { opacity: '0', transform: 'translateY(10px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
            },
        },
    },
};
