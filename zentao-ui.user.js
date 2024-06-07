// ==UserScript==
// @name        禅道标记助手
// @namespace   Violentmonkey Scripts
// @match       http*://*/zentao/*
// @require     https://unpkg.com/jquery@3.3.1/dist/jquery.min.js
// @require     https://unpkg.com/cn-workday@1.0.11/dist/cn-workday.js
// @grant       GM_addStyle
// @grant       GM_setClipboard
// @version     1.3.3
// @author      LinHQ
// @license     GPLv3
// @description 标记 bug 留存时间、计算每日工时、一键复制解决的 bug、解决指派 bug 强制填写工时、Bug 点击在新标签页打开
// ==/UserScript==

(() => {
  $.noConflict(true)(document).ready(async ($) => {
    const userName = localStorage.getItem('zm-username')
    if (!userName) {
      const name = prompt("看上去你是第一次使用，请输入禅道中的姓名：")
      if (name) localStorage.setItem('zm-username', name)
      else return
    }

    const colors = {
      green: '#82E0AA',
      yellow: '#F7DC6F ',
      brown: '#FE9900',
      red: '#E74C3C'
    }

    $("td.text-left a").attr('target', '_blank')

    switch (document.location.pathname) {
      case '/zentao/effort-calendar.html':
        GM_addStyle(`
        span.zm-day {
          font-weight: bold;
          margin: 0 8px;
        }
        .warn {
          color: ${colors.brown};
        }
        .fine {
          color: ${colors.green};
        }
        `)
        const element = await waitElement('table')
        const obs = new MutationObserver(mark)
        function mark(_, observe) {
          observe.disconnect()
          const days = element.querySelectorAll(".cell-day")
          days.forEach(dayElement => {
            const timeEles = dayElement.querySelectorAll('.has-time .time')
            const total = Array.from(timeEles).reduce((total, time) => total + parseFloat(time.textContent), 0)
            $(dayElement).find('.zm-day').remove()
            if (total != 0) $(dayElement).find('.heading').prepend(`<span class="zm-day ${total > 10 || total < 8 ? 'warn' : 'fine'}">【${total.toFixed(1)}小时】</span>`)
          })
          obs.observe(element, { subtree: true, childList: true })
        }
        obs.observe(element, { subtree: true, childList: true })
        mark(undefined, obs)
        break
      case '/zentao/my-work-bug.html':
        GM_addStyle(`
        td.text-left.nobr {
          white-space: normal;
        }
        span.zm-mark {
          padding: 2px;
          border-radius: 4px;
          border: 1px solid;
          font-size: .9em;
        }
        `)
        const btn = $(`<div class='btn-toolbar pull-right'>
          <div class="btn btn-warning">
            获取bug时间
          </div>
        </div>`)
          .on('click', async function () {
            // TODO: 可能要处理翻页问题
            let last = await refresh()
            last = last.map(({ start, hasReactive }) => ({ ...timeRangeStr(start), processed: hasReactive }))

            $("tr th:nth-child(9)").text('Bug 留存').removeClass('text-center')
            $("tr td:nth-child(9)").each((idx, ele) => {
              const cell = $(ele).empty().html(`<span class="zm-mark">${last[idx].str}</span>`)
              const { h, processed } = last[idx]
              /*
                36 - 72 未处理/已处理 2 小时余量
                0-12 绿/绿
                12-24 黄/绿
                24-36 深黄/黄
                36-72 红/深黄
                72-x 红/红
              */
              if (h < 12) cell.css({ color: colors.green })
              else if (h < 24) cell.css({ color: !processed ? colors.yellow : colors.green })
              else if (h < 34) cell.css({ color: !processed ? colors.brown : colors.yellow })
              else if (h < 70) cell.css({ color: !processed ? colors.red : colors.brown })
              else cell.css({ color: colors.red })
            })
          }).appendTo('#mainMenu')

        if ($('tr').length < 9) btn.click()

        async function refresh() {
          const bugs = $("tr td:nth-child(5) a").map((_, ele) => fetchDocument(ele.href)).get()
          const res = await Promise.all(bugs)
          return res.map(parseBugPage)
        }
        break
      default:
        const path = document.location.pathname
        // bug 详情页功能
        if (/bug-view-\d+\.html$/m.test(path)) {
          // 点击 bug 编号复制
          $('.label.label-id').on('click', function () {
            GM_setClipboard(`:bug: ${$(this).text().trim()} ${$(this).next().text().trim().replace(/【.+】/, '')}`)
          }).attr('title', '点击复制 Bug').css({ cursor: 'pointer' })
          // 强制填工时
          $('a').has('.icon-bug-resolve, .icon-bug-assignTo').get()
            .forEach(e => e.addEventListener('click', function (e) {
              const { needEffort } = parseBugPage()
              if (needEffort) {
                // 阻止按钮本来行为
                e.stopPropagation()
                e.preventDefault()
                // jquery 不会触发 a 标签上的 click 
                $('a.effort').get(0).click()
              }
            }, true))
        } else if (/bug-browse/.test(path)) {
          $('<div class="btn btn-success">复制勾选</div>').on('click', function () {
            const bugs = $('tr.checked').map(function () {
              const tds = $(this).find("td")
              const id = $(tds[0]).text().trim()
              const raw = $(tds[4]).text().trim()
              // 主要匹配，开头不能是数字和其他方括号
              let range = raw.match(/【([^【】]+?\/.+?)】/)
              range = !range ? '' : range[1].replace(/(\d\.?|-){3}/, '') //移除版本号
              const title = raw.slice(raw.lastIndexOf('】') + 1, raw.length)
              return `${userName}\t\t${id} ${title}\t${range}\n`
            })
            GM_setClipboard(bugs.get().join(''))
          }).insertBefore('.btn-group.dropdown')
        }
        break
    }

    function timeRangeStr(start, end = Date.now()) {
      start = new Date(start)
      end = new Date(end)
      const d = 3.6e6 * 24

      let ms = 0
      while (start.getTime() < end) {
        /* TODO: 暂时先用某一个手打的库来判断，后续考虑自动爬gov.com数据 */
        if (CnWorkday.isWorkday(start)) {
          ms += d
        }
        /* TODO: 节假日跳过 */
        start.setDate(start.getDate() + 1)
      }
      // 一般是负的，退回多加的部分
      ms += end - start
      ms = Math.max(ms, 0)

      const rawh = ms / 3.6e6

      let h, m
      h = Math.trunc(rawh)
      m = Math.trunc((rawh - h) * 60)
      return { str: `${h} 小时 ${m} 分钟`, h, m }
    }

    function parseBugPage(document = window.document) {
      const processedRe = new RegExp(`由.${userName}.(指派|解决|确认|添加)`)
        , effortRe = new RegExp(`由.${userName}.记录工时`)
        , assignRe = new RegExp(`由.${userName}.指派`)
        , assignedRe = new RegExp(`指派给.${userName}`)
        , dateRe = /(\d{4}-.+:\d{2})/

      /* 当前指派
       * 格式一：XXX
       * 格式二：XXX 于 DDDD
       */
      const current = $('#legendBasicInfo th:contains(当前指派) ~ td').text().trim()

      let start
        , assignmens = []
        , hasReactive = false
        , needEffort = current.includes(userName)
        , reactives = []

      $(document).find('#actionbox li').each(function () {
        const text = $(this).text().trim()
        // 注意，不与其他判断互斥，比如和 assignRe
        if (processedRe.test(text)) {
          hasReactive = true
          reactives.push({ time: new Date(text.match(dateRe)[1]), action: text })
        }
        if (effortRe.test(text)) {
          needEffort = false
        }
        if (/由.+创建/.test(text)) {
          start = new Date(text.match(dateRe)[1])
        }
        if (assignRe.test(text)) {
          assignmens.push({ toMe: false, time: new Date(text.match(dateRe)[1]) })
        }
        if (assignedRe.test(text)) {
          // 被指派，但 创建->指派出去->第一次指回 取创建不取第一次指回
          assignmens.push({ toMe: true, time: new Date(text.match(dateRe)[1]) })
          if (assignmens.length && assignmens[0].toMe) {
            start = assignmens[0].time
          }
          // 又被指派的话日志再填一下，当然，当前指派需要是自己
          needEffort = current.includes(userName)
        }
      })

      const dbg = { start: new Date(start).toLocaleString(), reactives, assignmens, hasReactive, needEffort }
      console.log('(zm)DEBUG: ', dbg)
      // bug 创建或第一次被指派时间，和 bug 最后交互时间，当前指派人
      return { start, reactives, assignmens, hasReactive, needEffort }
    }

    async function fetchDocument(url) {
      this.loading = true
      const page = await fetch(url).then(resp => resp.arrayBuffer()),
        decoder = new TextDecoder(document.characterSet)

      return new DOMParser().parseFromString(decoder.decode(page), 'text/html')
    }

    async function waitElement(selector, root = document.body) {
      return new Promise((res, rej) => {
        const observe = new MutationObserver((list, observer) => {
          for (const record of list) {
            const result = record.target.querySelector(selector)
            if (result) {
              res(result)
              observer.disconnect()
            }
          }
        })
        observe.observe(root, {
          subtree: true,
          childList: true
        })
      })
    }

  })
})()
