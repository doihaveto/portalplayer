var base_url = 'https://theportal.wiki'
var player = document.getElementById('player');
var track = document.getElementById('transcript');
var progress_bar = document.getElementById('progress-bar');
var url = new URL(window.location.href);
var episode_title = url.searchParams.get('ep');
var wiki_html = '';
var resources = [];
var cur_volume = 1;
var progress_hover = false;
var transcript_paragraph_deadair = 0.2;
var prev_active_cue, prev_active_resource, prev_active_note;
var scroll_counter = 0;
var scroll_track = true;

var voice_span_regex = /\<v ([^\>]+)\>/g;

function format_seconds(s) {
    var t = new Date(s * 1000).toISOString().substr(11, 8);
    if (t.substr(0, 3) == '00:')
        t = t.substr(3);
    return t;
}

function timestamp_to_seconds(s) {
    var a = s.split(':');
    return (+a[0]) * 60 * 60 + (+a[1]) * 60 + (+a[2]); 
}

function parse_wiki_html() {
    player.src = wiki_html.find('a[href$=".mp3"]').attr('href');
    var track_src = wiki_html.find('a[href$=".vtt"]');
    if (track_src.length) {
        track.onload = load_transcript;
        track.src = track_src.attr('href');
        player.textTracks[0].mode = 'hidden';
    }
    wiki_html.find('[href^="/"], [src^="/"]').each(function() {
        if ('href' in this.attributes && this.attributes.href.value.substr(0, 1) == '/')
            this.attributes.href.value = base_url + this.attributes.href.value;
        if ('src' in this.attributes && this.attributes.src.value.substr(0, 1) == '/')
            this.attributes.src.value = base_url + this.attributes.src.value;
    });
    wiki_html.find('div[data-timestamp').each(function(i, resource) {
        var id = 'resource-' + i;
        var resource_type = $(resource).data('type');
        if (resource_type == 'resource')
            $('#resources-pane .pane-content').append($(resource));
        else if (resource_type == 'note')
            $('#notes-pane .pane-content').append($(resource));
        else
            return;
        var timestamps = $(resource).data('timestamp').split(',').map(s => s.split('-').map(timestamp_to_seconds));
        resources.push({
            id: id,
            type: resource_type,
            timestamps: timestamps,
        });
        if (timestamps.length)
            $(resource).attr('id', id).css('order', timestamps[0]);
    });
}

function parse_episode_list(response) {
    var eplist_html = $(response.parse.text['*']);
    var ul = document.querySelector('#episode-list .pane-content ul');
    eplist_html.find('td a[href][title]').each(function() {
        var title = this.attributes.title.value;
        if (title.indexOf(':') && !isNaN(parseInt(title.split(':')[0]))) {
            var url = window.location.pathname + '?ep=' + this.attributes.href.value.replace('/wiki/', '');
            var li = document.createElement('li');
            var a = document.createElement('a');
            a.href = url;
            a.text = title;
            li.appendChild(a);
            ul.appendChild(li);
        }
    });
}

function load_transcript() {
    var parahraphs = [];
    var parahraph = [];
    var prev_time = 0;
    var prev_speaker, cur_speaker;
    [... player.textTracks[0].cues].forEach(cue => {
        var voice_span_matches = voice_span_regex.exec(cue.text);
        if (voice_span_matches) {
            cur_speaker = voice_span_matches[1];
            if (cur_speaker == prev_speaker) {
                cue.text = cue.text.replace(voice_span_regex, '');
            }
        }
        cue.clean_text = cue.text.replace(voice_span_regex, '$1: ');
        if (prev_time && ((cue.startTime - prev_time >= transcript_paragraph_deadair && ['.', '?'].indexOf(cue.clean_text.trim().substr(-1)) != -1) || (prev_speaker && cur_speaker != prev_speaker))) {
            parahraphs.push(parahraph);
            parahraph = [];
        }
        parahraph.push(cue);
        prev_time = cue.endTime;
        if (cur_speaker)
            prev_speaker = cur_speaker;
    });
    if (parahraph.length)
        parahraphs.push(parahraph);
    var transcript_el = document.querySelector('#transcript-pane .pane-content');
    parahraphs.forEach(paragraph => {
        var p = document.createElement('p');
        paragraph.forEach(cue => {
            var span = document.createElement('span');
            span.textContent = cue.clean_text + ' ';
            cue.transcript_span = span;
            p.appendChild(span);
        });
        transcript_el.appendChild(p);
    });
}

$('#play').on('click', function() {
    if (isNaN(player.duration))
        return;
    if (player.paused) {
        player.play();
        $('#play-pause').removeClass('play').addClass('pause');
    } else {
        player.pause();
        $('#play-pause').removeClass('pause').addClass('play');
    }
});

player.addEventListener('canplay', () => {
    $('#player-time').text(format_seconds(player.currentTime) + ' / ' + format_seconds(player.duration));
});

player.addEventListener('timeupdate', () => {
    if (isNaN(player.duration) || progress_hover)
        return;
    progress_bar.value = player.currentTime / player.duration;
    $('#player-time').text(format_seconds(player.currentTime) + ' / ' + format_seconds(player.duration));
    var active_resources = [];
    var last_active_note;
    resources.forEach(resource => {
        var el = document.getElementById(resource.id);
        var active_timestamps = resource.timestamps.map(range => {
            let [start, end] = range;
            if (start <= player.currentTime && (!end || end >= player.currentTime))
                return start;
            return false;
        }).filter(s => s).sort().reverse();
        if (active_timestamps.length) {
            active_resources.push(el);
            el.classList.add('active');
            el.last_timestamp = active_timestamps[0];
        }
    });
    active_resources.sort((a, b) => a.last_timestamp - b.last_timestamp);
    var last_active_resource = active_resources.filter(resource => $(resource).data('type') == 'resource').pop();
    var last_active_note = active_resources.filter(resource => $(resource).data('type') == 'note').pop();
    document.querySelectorAll('#resources-pane .active, #notes-pane .active').forEach(el => {
        if (el != last_active_resource && el != last_active_note)
            el.classList.remove('active')
    });
    if (last_active_resource && last_active_resource != prev_active_resource) {
        $('#resources-pane').animate({
            scrollTop: last_active_resource.offsetTop - (last_active_resource.offsetParent.offsetHeight / 2) + (last_active_resource.offsetHeight / 2)
        }, 300);
    }
    if (last_active_note && last_active_note != prev_active_note)
        $('#notes-pane').animate({
            scrollTop: last_active_note.offsetTop - (last_active_note.offsetParent.offsetHeight / 2) + (last_active_note.offsetHeight / 2)
        }, 300);
    prev_active_resource = last_active_resource;
    prev_active_note = last_active_note;
    if (player.textTracks[0].mode == 'hidden') {
        var active_spans = [];
        var last_active_cue;
        [... player.textTracks[0].activeCues].forEach(cue => {
            cue.transcript_span.classList.add('active');
            active_spans.push(cue.transcript_span);
            last_active_cue = cue.transcript_span;
        });
        document.querySelectorAll('#transcript-pane span.active').forEach(span => {
            if (active_spans.indexOf(span) == -1)
                span.classList.remove('active')
        });
        if (scroll_track && last_active_cue && last_active_cue != prev_active_cue) {
            $('#transcript-pane').animate({
                scrollTop: last_active_cue.offsetTop - (last_active_cue.offsetParent.offsetHeight / 2) + (last_active_cue.offsetHeight / 2)
            }, 300);
            scroll_counter = 0;
        }
        prev_active_cue = last_active_cue;
    }
});

$('#progress-bar').click(function(e) {
    if (isNaN(player.duration))
        return;
    var percent = e.offsetX / this.offsetWidth;
    player.currentTime = percent * player.duration;
    progress_bar.value = percent / 100;
}).mousemove(function(e) {
    if (isNaN(player.duration))
        return;
    progress_hover = true;
    var percent = e.offsetX / this.offsetWidth;
    $('#player-time').text(format_seconds(percent * player.duration) + ' / ' + format_seconds(player.duration));
    progress_bar.value = percent;
}).mouseout(function() {
    progress_hover = false;
    $(player).trigger('timeupdate');
});

$('.speed-btn').click(function(e) {
    e.preventDefault();
    var speed = parseFloat($('#speed').text());
    if ($(this).hasClass('up'))
        speed += 0.1;
    else
        speed -= 0.1;
    speed = Math.round( speed * 10 ) / 10;
    player.playbackRate = speed;
    $('#speed').text(speed);
});

$('.volume-icon').click(function() {
    if ($(this).hasClass('on')) {
        player.volume = 0;
        $(this).removeClass('on').addClass('off');
        $('#volume-slider').slider('value', 0);
    } else {
        player.volume = cur_volume;
        $(this).removeClass('off').addClass('on');
        $('#volume-slider').slider('value', player.volume * 100);
    }
})

$('#volume-slider').slider({
    min: 0,
    max: 100,
    value: 100,
    range: 'min',
    slide: function(e, ui) {
        let v = ui.value / 100;
        player.volume = v;
        cur_volume = v;
    }
});

$('#transcript-pane').scroll(function(e) {
    if (e.originalEvent && !$(this).is(':animated')) {
        scroll_counter++;
        if (scroll_counter > 3) {
            scroll_track = false;
            $('#transcript-pane .focus').show();
        }
    }
});

$('#transcript-pane .focus').click(function() {
    scroll_track = true;
    $('#transcript-pane .focus').hide();
    prev_active_cue = null;
    $(player).trigger('timeupdate');
});

$('#episode-list-open').click(function() {
    $('#episode-list').toggle();
});

$('#episode-list .close').click(function() {
    $('#episode-list').hide();
});

if (episode_title) {
    $.ajax({
        url: 'https://theportal.wiki/api.php',
        jsonp: 'callback',
        dataType: 'jsonp',
        data: {
            action: 'parse',
            page: episode_title,
            prop: 'text',
            format: 'json',
            utf8: '1',
        },
        success: function(response) {
            wiki_html = $(response['parse']['text']['*']);
            $('#episode-title').text(response['parse']['title']);
            parse_wiki_html();
        }
    });
}

$.ajax({
    url: 'https://theportal.wiki/api.php',
    jsonp: 'callback',
    dataType: 'jsonp',
    data: {
        action: 'parse',
        page: 'All_Episodes',
        prop: 'text',
        format: 'json',
        utf8: '1',
    },
    success: function(response) {
        parse_episode_list(response);
    }
});
